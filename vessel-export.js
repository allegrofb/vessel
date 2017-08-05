'use strict';

// System Objects
const cp = require('child_process');
const Duplex = require('stream').Duplex;
const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const net = require('net');
const util = require('util');
const path = require('path');

const defOptions = {
  ports: {
    A: true,
    B: true,
  }
};

const pwmBankSettings = {
  period: 0,
  prescalarIndex: 0,
};

const reusableNoOp = () => {};
const enforceCallback = callback => typeof callback === 'function' ? callback : reusableNoOp;

// Port Name Constants
const A = 'A';
const B = 'B';

const ANALOG_RESOLUTION = 4096;
// Maximum number of ticks before period completes
const PWM_MAX_PERIOD = 0xFFFF;
// Actual lowest frequency is ~0.72Hz but 1Hz is easier to remember.
// 5000 is the max because any higher and the resolution drops
// below 7% (0xFFFF/5000 ~ 7.69) which is confusing
const PWM_MAX_FREQUENCY = 5000;
const PWM_MIN_FREQUENCY = 1;
const PWM_PRESCALARS = [1, 2, 4, 8, 16, 64, 256, 1024];
// Maximum number of unscaled ticks in a second (48 MHz)
const SAMD21_TICKS_PER_SECOND = 48000000;
// GPIO number of RESET pin
const SAMD21_RESET_GPIO = 39;

// Per pin capabilities
const ADC_PINS = [4, 7];
const INT_PINS = [2, 5, 6, 7];
const PULL_PINS = [2, 3, 4, 5, 6, 7];
const PWM_PINS = [5, 6];

const INT_MODES = {
  rise: 1,
  fall: 2,
  change: 3,
  high: 4,
  low: 5,
};

const PULL_MODES = {
  pulldown: 0,
  pullup: 1,
  none: 2,
};

const CMD = {
  NOP: 0,
  FLUSH: 1,
  ECHO: 2,
  GPIO_IN: 3,
  GPIO_HIGH: 4,
  GPIO_LOW: 5,
  GPIO_TOGGLE: 21,
  GPIO_CFG: 6,
  GPIO_WAIT: 7,
  GPIO_INT: 8,
  GPIO_INPUT: 22,
  GPIO_RAW_READ: 23,
  GPIO_PULL: 26,
  ANALOG_READ: 24,
  ANALOG_WRITE: 25,
  ENABLE_SPI: 10,
  DISABLE_SPI: 11,
  ENABLE_I2C: 12,
  DISABLE_I2C: 13,
  ENABLE_UART: 14,
  DISABLE_UART: 15,
  TX: 16,
  RX: 17,
  TXRX: 18,
  START: 19,
  STOP: 20,
  PWM_DUTY_CYCLE: 27,
  PWM_PERIOD: 28,
};

const REPLY = {
  ACK: 0x80,
  NACK: 0x81,
  HIGH: 0x82,
  LOW: 0x83,
  DATA: 0x84,

  MIN_ASYNC: 0xA0,
  ASYNC_PIN_CHANGE_N: 0xC0, // c0 to c8 is all async pin assignments
  ASYNC_UART_RX: 0xD0
};

class Vessel {
  constructor(options) {
    if (Vessel.instance) {
      return Vessel.instance;
    } else {
      Vessel.instance = this;
    }

    // If the user program has provided a _valid_ options object, or use default
    options = typeof options === 'object' && options !== null ? options : defOptions;

    // If the user program has passed an options object that doesn't
    // contain a `ports` property, or the value of the `ports` property
    // is null or undefined: use the default.
    if (options.ports == null) {
      options.ports = defOptions.ports;
    }

    // For compatibility with T1 code, ensure that all ports are initialized by default.
    // This means that only an explicit `A: false` or `B: false` will result in a
    // port not being initialized. If the property is not present, null or undefined,
    // it will be set to `true`.
    //
    // ONLY a value of `false` can prevent the port from being initialized!
    //
    if (options.ports.A == null) {
      options.ports.A = true;
    }

    if (options.ports.B == null) {
      options.ports.B = true;
    }

    this.ports = {
      A: options.ports.A ? new Vessel.Port(A, Vessel.Port.PATH.A, this) : null,
      B: options.ports.B ? new Vessel.Port(B, Vessel.Port.PATH.B, this) : null,
    };

    this.port = this.ports;

    this.led = new Vessel.LEDs([{
      color: 'red',
      type: 'error'
    }, {
      color: 'amber',
      type: 'wlan'
    }, {
      color: 'green',
      type: 'user1'
    }, {
      color: 'blue',
      type: 'user2'
    }, ]);

    this.leds = this.led;

    this.network = {
      wifi: new Vessel.Wifi(),
      ap: new Vessel.AP(),
    };

    // tessel v1 does not have this version number
    // this is useful for libraries to adapt to changes
    // such as all pin reads/writes becoming async in version 2
    this.version = 2;
  }

  close(portName) {
    if (portName !== undefined) {
      // This _could_ be combined with the above condition,
      // but is separate since the open() method has a
      // necessarily nested condition and this _may_ require
      // further conditional restrictions in the future.
      /* istanbul ignore else */
      if (this.port[portName]) {
        this.port[portName].close();
      }
    } else {
      [A, B].forEach(name => this.close(name));
    }
    return this;
  }

  open(portName) {
    if (portName !== undefined) {
      // If there _is not_ a port created with this port name;
      // Or there _is_, but the socket was previously destroyed...
      if (!this.port[portName] ||
        (this.port[portName] && this.port[portName].sock.destroyed)) {
        this.port[portName] = new Vessel.Port(portName, Vessel.Port.PATH[portName], this);
      }
    } else {
      [A, B].forEach(name => this.open(name));
    }
    return this;
  }

  reboot() {

    this.close();

    // When attempting to reboot, if the sockets
    // are left open at the moment that `reboot`
    // is executed, there will be a substantial
    // delay before the actual reboot occurs.
    // Polling for `destroyed` signals ensures
    // that the sockets are closed before
    // `reboot` is executed.
    const pollUntilSocketsDestroyed = () => {
      /* istanbul ignore else */
      if (this.port.A.sock.destroyed &&
        this.port.B.sock.destroyed) {

        // Stop SPI communication between SAMD21 and MediaTek
        cp.execSync('/etc/init.d/spid stop');

        // Create a GPIO entry for the SAMD21 RESET pin
        cp.execSync(`echo "${SAMD21_RESET_GPIO}" > /sys/class/gpio/export`);
        // Make that GPIO an output
        cp.execSync(`echo "out" > /sys/class/gpio/gpio${SAMD21_RESET_GPIO}/direction`);
        // Pull the output low to reset the SAMD21
        cp.execSync(`echo "0" > /sys/class/gpio/gpio${SAMD21_RESET_GPIO}/value`);

        // Reboot the MediaTek
        cp.execSync('reboot');
      } else {
        setImmediate(pollUntilSocketsDestroyed);
      }
    };

    pollUntilSocketsDestroyed();
  }

  pwmFrequency(frequency, callback) {
    if (frequency < PWM_MIN_FREQUENCY ||
      frequency > PWM_MAX_FREQUENCY) {
      throw new RangeError(`PWM Frequency value must be between ${PWM_MIN_FREQUENCY} and ${PWM_MAX_FREQUENCY}`);
    }

    const results = determineDutyCycleAndPrescalar(frequency);

    pwmBankSettings.period = results.period;
    pwmBankSettings.prescalarIndex = results.prescalarIndex;

    // We are currently only using TCC Bank 0
    // This may be expanded in the future to enable PWM on more pins
    const TCC_ID = 0;

    const packet = new Buffer(4);
    // Write the command id first
    packet.writeUInt8(CMD.PWM_PERIOD, 0);
    // Write our prescalar to the top 4 bits and TCC id to the bottom 4 bits
    packet.writeUInt8((pwmBankSettings.prescalarIndex << 4) | TCC_ID, 1);
    // Write our period (16 bits)
    packet.writeUInt16BE(pwmBankSettings.period, 2);

    // Send the packet off to the samd21
    // on the first available port object (regardless of name)
    this.port[[A, B].find(name => this.ports[name] !== null)].sock.write(packet, callback);
  }
}

const priv = new WeakMap();

class Port extends EventEmitter {
  constructor(name, path, board) {
    super();

    const port = this;
    let uart = null;
    let spi = null;

    priv.set(this, {
      get uart() {
        return uart;
      },
      set uart(value) {
        uart = value;
      },
      get spi() {
        return spi;
      },
      set spi(value) {
        spi = value;
      },
    });

    Object.defineProperties(this, {
      spi: {
        get() {
          return spi;
        },
      },
      uart: {
        get() {
          return uart;
        },
      },
    });

    this.name = name;
    this.board = board;

    // Connection to the SPI daemon
    this.sock = net.createConnection({
      path
    }, error => {
      /* istanbul ignore else */
      if (error) {
        throw error;
      }
    });

    // Number of tasks occupying the socket
    this.pending = 0;

    // Unreference this socket so that the script will exit
    // if nothing else is waiting in the event queue.
    this.unref();

    this.sock.on('error', error => {
      console.log(`Socket: Error occurred: ${error.toString()}`);
    });

    this.sock.on('end', () => {
      console.log('Socket: The other end sent FIN packet.');
    });

    this.sock.on('close', () => {
      if (!this.sock.isAllowedToClose) {
        throw new Error('Socket: The Port socket has closed.');
      }
    });

    // Track whether the port should treat closing
    // as an error. This will be set to true when `tessel.close()`
    // is called, to indicate that the closing is intentional and
    // therefore should be allow to proceed.
    this.sock.isAllowedToClose = false;

    let replyBuf = new Buffer(0);

    this.sock.on('readable', () => {
      let queued;
      // This value can potentially be `null`.
      const available = new Buffer(this.sock.read() || 0);

      // Copy incoming data into the reply buffer
      replyBuf = Buffer.concat([replyBuf, available]);

      // While we still have data to process in the buffer
      while (replyBuf.length !== 0) {
        // Grab the next byte
        const byte = replyBuf[0];
        // If the next byte equals the marker for a uart incoming
        if (byte === REPLY.ASYNC_UART_RX) {
          // Get the next byte which is the number of bytes
          const rxNum = replyBuf[1];
          // As long as the number of bytes of rx buffer exists
          // and we have at least the number of bytes needed for a uart rx packet
          if (rxNum !== undefined && replyBuf.length >= 2 + rxNum) {
            // Read the incoming data
            const rxData = replyBuf.slice(2, 2 + rxNum);
            // Cut those bytes out of the reply buf packet so we don't
            // process them again
            replyBuf = replyBuf.slice(2 + rxNum);

            // If a uart port was instantiated
            /* istanbul ignore else */
            if (uart) {
              // Push this data into the buffer
              uart.push(rxData);
            }
            // Something went wrong and the packet is malformed
          } else {
            break;
          }
          // This is some other async transaction
        } else if (byte >= REPLY.MIN_ASYNC) {
          // If this is a pin change
          if (byte >= REPLY.ASYNC_PIN_CHANGE_N && byte < REPLY.ASYNC_PIN_CHANGE_N + 16) {
            // Pull out the pin number (requires clearing the value bit)
            const pin = this.pin[(byte - REPLY.ASYNC_PIN_CHANGE_N) & ~(1 << 3)];
            // Get the mode change
            const mode = pin.interruptMode;
            // Get the pin value
            const pinValue = (byte >> 3) & 1;

            // For one-time 'low' or 'high' event
            if (mode === 'low' || mode === 'high') {
              pin.emit(mode);
              // Reset the pin interrupt state (prevent constant interrupts)
              pin.interruptMode = null;
              // Decrement the number of tasks waiting on the socket
              this.unref();
            } else {
              // Emit the change and rise or fall
              pin.emit('change', pinValue);
              pin.emit(pinValue ? 'rise' : 'fall');
            }

          } else {
            // Some other async event
            this.emit('async-event', byte);
          }

          // Cut this byte off of the reply buffer
          replyBuf = replyBuf.slice(1);
        } else {
          // If there are no commands awaiting a response
          if (this.replyQueue.length === 0) {
            // Throw an error... something went wrong
            throw new Error(`Received unexpected response with no commands pending: ${byte}`);
          }

          // Get the size if the incoming packet
          const size = this.replyQueue[0].size;

          // If we have reply data
          if (byte === REPLY.DATA) {
            // Ensure that the packet size agrees
            if (!size) {
              throw new Error('Received unexpected data packet');
            }

            // The number of data bytes expected have been received.
            if (replyBuf.length >= 1 + size) {
              // Extract the data
              const data = replyBuf.slice(1, 1 + size);
              // Slice this data off of the buffer
              replyBuf = replyBuf.slice(1 + size);
              // Get the  queued command
              queued = this.dequeue();

              // If there is a callback for th ecommand
              /* istanbul ignore else */
              if (queued.callback) {
                // Return the data in the callback
                queued.callback.call(this, null, data);
              }
            } else {
              // The buffer does not have the correct number of
              // date bytes to fulfill the requirements of the
              // reply queue's next registered handler.
              break;
            }
            // If it's just one byte being returned
          } else {
            /* istanbul ignore else */
            if (byte === REPLY.HIGH || byte === REPLY.LOW) {
              // Slice it off
              replyBuf = replyBuf.slice(1);
              // Get the callback in the queue
              queued = this.dequeue();

              // If a callback was provided
              /* istanbul ignore else */
              if (queued.callback) {
                // Return the byte in the callback
                queued.callback.call(this, null, byte);
              }
            }
          }
        }
      }
    });

    // Active peripheral: 'none', 'i2c', 'spi', 'uart'
    this.mode = 'none';

    // Array of {size, callback} used to dispatch replies
    this.replyQueue = [];

    this.pin = [];
    for (let i = 0; i < 8; i++) {
      this.pin.push(new Vessel.Pin(i, this));
    }

    // Deprecated properties for Vessel 1 backwards compatibility:
    this.pin.G1 = this.pin.g1 = this.pin[5];
    this.pin.G2 = this.pin.g2 = this.pin[6];
    this.pin.G3 = this.pin.g3 = this.pin[7];
    this.digital = [this.pin[5], this.pin[6], this.pin[7]];

    this.pwm = [this.pin[5], this.pin[6]];

    // This are function expressions because
    // they MUST be constructable (arrows disallow)
    this.I2C = function(address) {
      const options = {};

      if (typeof address === 'object' && address != null) {
        /*
          {
            addr: address,
            freq: frequency,
            port: port,
          }
        */
        Object.assign(options, address);
      } else {
        /*
          (address)
        */
        options.address = address;
      }

      /*
        Always ensure that the options
        object contains a port property
        with this port as its value.
      */
      if (!options.port) {
        options.port = port;
      } else {
        /*
          When receiving an object containing
          options information, it's possible that
          the calling code accidentally sends
          a "port" that isn't this port.
        */
        /* istanbul ignore else */
        if (options.port !== port) {
          options.port = port;
        }
      }

      return new Vessel.I2C(options);
    };

    this.I2C.enabled = false;

    // This are function expressions because
    // they MUST be constructable (arrows disallow)
    this.SPI = function(options) {
      if (spi) {
        spi.disable();
      }

      spi = new Vessel.SPI(options || {}, port);

      return spi;
    };

    // This are function expressions because
    // they MUST be constructable (arrows disallow)
    this.UART = function(options) {
      if (uart) {
        uart.disable();
      }

      uart = new Vessel.UART(options || {}, port);
      // Grab a reference to this socket so it doesn't close
      // if we're waiting for UART data
      port.ref();

      return uart;
    };
  }

  close() {
    /* istanbul ignore else */
    if (!this.sock.destroyed) {
      this.sock.isAllowedToClose = true;
      this.sock.destroy();
    }
  }

  ref() {
    // Increase the number of pending tasks
    this.pending++;
    // Ensure this socket stays open until unref'ed
    this.sock.ref();
  }

  unref() {
    // If we have pending tasks to complete
    if (this.pending > 0) {
      // Subtract the one that is being unref'ed
      this.pending--;
    }

    // If this was the last task
    if (this.pending === 0) {
      // Unref the socket so the process doesn't hang open
      this.sock.unref();
    }
  }

  enqueue(reply) {
    this.ref();
    this.replyQueue.push(reply);
  }

  dequeue() {
    this.unref();
    return this.replyQueue.shift();
  }

  cork() {
    this.sock.cork();
  }

  uncork() {
    this.sock.uncork();
  }

  sync(callback) {
    if (callback) {
      this.sock.write(new Buffer([CMD.ECHO, 1, 0x88]));
      this.enqueue({
        size: 1,
        callback
      });
    }
  }

  command(data, callback) {
    this.cork();
    this.sock.write(new Buffer(data));
    this.sync(callback);
    this.uncork();
  }

  status(data, callback) {
    this.sock.write(new Buffer(data));
    this.enqueue({
      size: 0,
      callback,
    });
  }

  tx(data, callback) {
    let offset = 0;
    let chunk;

    if (data.length === 0) {
      throw new RangeError('Buffer size must be non-zero');
    }

    this.cork();

    // The protocol only supports <256 byte transfers, chunk if data is bigger
    while (offset < data.length) {
      chunk = data.slice(offset, offset + 255);

      this.sock.write(new Buffer([CMD.TX, chunk.length]));
      this.sock.write(chunk);

      offset += 255;
    }

    this.sync(callback);
    this.uncork();
  }

  rx(len, callback) {
    if (len === 0 || len > 255) {
      throw new RangeError('Buffer size must be within 1-255');
    }

    this.sock.write(new Buffer([CMD.RX, len]));
    this.enqueue({
      size: len,
      callback,
    });
  }

  txrx(buf, callback) {
    const len = buf.length;

    if (len === 0 || len > 255) {
      throw new RangeError('Buffer size must be within 1-255');
    }

    this.cork();
    this.sock.write(new Buffer([CMD.TXRX, len]));
    this.sock.write(buf);
    this.enqueue({
      size: len,
      callback,
    });
    this.uncork();
  }
}

// Port.PATH = {
  // A: '/var/run/tessel/port_a',
  // B: '/var/run/tessel/port_b'
// };

Port.PATH = {        //hyjiang
 A: path.join('\\\\?\\pipe', 'fakedevice', 'port_a'),
 B: path.join('\\\\?\\pipe', 'fakedevice', 'port_b')
};



/*
 Takes in a desired frequency setting and outputs the
 necessary prescalar and duty cycle settings based on set period.
 Outputs an object in the form of:
 {
  prescalar: number (0-7),
  period: number (0-0xFFFF)
 }
*/
function determineDutyCycleAndPrescalar(frequency) {
  // Current setting for the prescalar
  let prescalarIndex = 0;
  // Current period setting
  let period = 0;

  // If the current frequency would require a period greater than the max
  while ((period = Math.floor((SAMD21_TICKS_PER_SECOND / PWM_PRESCALARS[prescalarIndex]) / frequency)) > PWM_MAX_PERIOD) {
    // Increase our clock prescalar
    prescalarIndex++;

    // If we have no higher prescalars
    if (prescalarIndex === PWM_PRESCALARS.length) {
      // Throw an error because this frequency is too low for our possible parameters
      throw new Error('Unable to find prescalar/duty cycle parameter match for frequency');
    }
  }

  // We have found a period inside a suitable prescalar, return results
  return {
    period,
    prescalarIndex
  };
}

class Pin extends EventEmitter {
  constructor(pin, port) {
    super();

    this.pin = pin;
    this.port = port;
    this.isPWM = false;
    this.supports = {
      // These can be updated to use .includes()
      // once > Node 6 is supported.
      INT: INT_PINS.indexOf(pin) !== -1,
      ADC: ADC_PINS.indexOf(pin) !== -1 || port.name === B,
      PWM: PWM_PINS.indexOf(pin) !== -1,
      PULL: PULL_PINS.indexOf(pin) !== -1,
    };

    let interruptMode = null;

    Object.defineProperties(this, {
      interruptMode: {
        configurable: true,
        get() {
          return interruptMode;
        },
        set(mode) {
          interruptMode = (mode === 'rise' || mode === 'fall') ? 'change' : mode;
          port.command([CMD.GPIO_INT, pin | (mode ? INT_MODES[mode] << 4 : 0)]);
        }
      }
    });
  }

  get resolution() {
    return ANALOG_RESOLUTION;
  }

  removeListener(event, listener) {
    // If it's an interrupt event, remove as necessary
    super.removeListener(event, listener);

    if (event === this.interruptMode && this.listenerCount(event) === 0) {
      this.interruptMode = null;
    }

    return this;
  }

  removeAllListeners(event) {
    /* istanbul ignore else */
    if (!event || event === this.interruptMode) {
      this.interruptMode = null;
    }

    super.removeAllListeners.apply(this, arguments);

    return this;
  }

  addListener(mode, callback) {
    // Check for valid pin event mode
    if (typeof INT_MODES[mode] !== 'undefined') {
      if (!this.supports.INT) {
        throw new Error(`Interrupts are not supported on pin ${this.pin}. Pins 2, 5, 6, and 7 on either port support interrupts.`);
      }

      // For one-time 'low' or 'high' event
      if ((mode === 'low' || mode === 'high') && !callback.listener) {
        throw new Error('Cannot use "on" with level interrupts. You can only use "once".');
      }

      // Can't set multiple listeners when using 'low' or 'high'
      if (this.interruptMode) {
        const singleEventModes = ['low', 'high'];
        if (singleEventModes.some(value => mode === value || this.interruptMode === value)) {
          throw new Error(`Cannot set pin interrupt mode to "${mode}"; already listening for "${this.interruptMode}". Can only set multiple listeners with "change", "rise" & "fall".`);
        }
      }

      // Set the socket reference so the script doesn't exit
      this.port.ref();
      this.interruptMode = mode;

      // Add the event listener
      super.on(mode, callback);
    } else {
      throw new Error(`Invalid pin event mode "${mode}". Valid modes are "change", "rise", "fall", "high" and "low".`);
    }
  }

  high(callback) {
    this.port.command([CMD.GPIO_HIGH, this.pin], callback);
    return this;
  }

  low(callback) {
    this.port.command([CMD.GPIO_LOW, this.pin], callback);
    return this;
  }

  toggle(callback) {
    this.port.command([CMD.GPIO_TOGGLE, this.pin], callback);
    return this;
  }

  output(value, callback) {
    if (value) {
      this.high(callback);
    } else {
      this.low(callback);
    }
    return this;
  }

  write(value, callback) {
    // same as .output
    return this.output(value, callback);
  }

  rawDirection() {
    throw new Error('pin.rawDirection is not supported on Vessel 2. Use .input() or .output()');
  }

  _readPin(cmd, callback) {
    this.port.cork();
    this.port.sock.write(new Buffer([cmd, this.pin]));
    this.port.enqueue({
      size: 0,
      callback: (error, data) => callback(error, data === REPLY.HIGH ? 1 : 0),
    });
    this.port.uncork();
  }

  rawRead(callback) {
    if (typeof callback !== 'function') {
      throw new Error('pin.rawRead is async, pass in a callback to get the value');
    }
    this._readPin(CMD.GPIO_RAW_READ, callback);
    return this;
  }

  input(callback) {
    this.port.command([CMD.GPIO_INPUT, this.pin], callback);
    return this;
  }

  read(callback) {
    if (typeof callback !== 'function') {
      throw new Error('pin.read is async, pass in a callback to get the value');
    }
    this._readPin(CMD.GPIO_IN, callback);
    return this;
  }

  pull(pullType, callback) {

    // Ensure this pin supports being pulled
    if (!this.supports.PULL) {
      throw new Error('Internal pull resistors are not available on this pin. Please use pins 2-7.');
    }

    // Set a default value to 'none';
    if (pullType === undefined) {
      pullType = 'none';
    }

    const mode = PULL_MODES[pullType];

    // Ensure a valid mode was requested
    if (mode === undefined) {
      throw new Error('Invalid pull type. Must be one of: "pullup", "pulldown", or "none"');
    }

    // Send the command to the coprocessor
    this.port.command([CMD.GPIO_PULL, (this.pin | (mode << 4))], callback);
  }

  readPulse() {
    throw new Error('Pin.readPulse is not yet implemented');
  }

  analogRead(callback) {
    if (!this.supports.ADC) {
      throw new RangeError('pin.analogRead is not supported on this pin. Analog read is supported on port A pins 4 and 7 and on all pins on port B');
    }

    if (typeof callback !== 'function') {
      throw new Error('analogPin.read is async, pass in a callback to get the value');
    }

    this.port.sock.write(new Buffer([CMD.ANALOG_READ, this.pin]));
    this.port.enqueue({
      size: 2,
      callback(err, data) {
        callback(err, (data[0] + (data[1] << 8)) / ANALOG_RESOLUTION);
      },
    });

    return this;
  }

  analogWrite(val) {
    // throw an error if this isn't the adc pin (port b, pin 7)
    if (this.port.name !== 'B' || this.pin !== 7) {
      throw new RangeError('Analog write can only be used on Pin 7 (G3) of Port B.');
    }

    const data = val * 0x3ff;
    if (data > 0x3ff || data < 0) {
      throw new RangeError('Analog write must be between 0 and 1');
    }

    this.port.sock.write(new Buffer([CMD.ANALOG_WRITE, data >> 8, data & 0xff]));
    return this;
  }

  // Duty cycle should be a value between 0 and 1
  pwmDutyCycle(dutyCycle, callback) {
    // throw an error if this pin doesn't support PWM
    if (!this.supports.PWM) {
      throw new RangeError('PWM can only be used on TX (pin 5) and RX (pin 6) of either module port.');
    }

    if (typeof dutyCycle !== 'number' || dutyCycle < 0 || dutyCycle > 1) {
      throw new RangeError('PWM duty cycle must be a number between 0 and 1');
    }

    // The frequency must be set prior to setting the duty cycle
    if (pwmBankSettings.period === 0) {
      throw new Error('PWM Frequency is not configured. You must call Vessel.pwmFrequency before setting duty cycle.');
    }

    // Calculate number of ticks for specified duty cycle
    const dutyCycleTicks = Math.floor(dutyCycle * pwmBankSettings.period);
    // Construct packet
    const packet = new Buffer([CMD.PWM_DUTY_CYCLE, this.pin, dutyCycleTicks >> 8, dutyCycleTicks & 0xff]);

    // Write it to the socket
    this.port.sock.write(packet, callback);

    return this;
  }
}

Pin.prototype.rawWrite = util.deprecate(function(value) {
  if (value) {
    this.high();
  } else {
    this.low();
  }
  return this;
}, 'pin.rawWrite is deprecated. Use .high() or .low()');


Pin.prototype.on = Pin.prototype.addListener;


class I2C {
  constructor(params) {
    let frequency = 1e5;

    if (params.address == null) {
      throw new Error('I2C expected an address');
    }

    Object.defineProperties(this, {
      frequency: {
        get() {
          return frequency;
        },
        set(value) {
          // Restrict to between 100kHz and 400kHz.
          // Can actually go up to 4mhz without clk modification
          if (value !== 1e5 && value !== 4e5) {
            // http://asf.atmel.com/docs/3.15.0/samd21/html/group__asfdoc__sam0__sercom__i2c__group.html#gace1e0023f2eee92565496a2e30006548
            throw new RangeError('I2C frequency must be 100kHz or 400kHz');
          }

          frequency = value;
        }
      },
      baudrate: {
        get() {
          return I2C.computeBaud(frequency);
        }
      }
    });

    this.port = params.port;

    // For t1-firmware compatibility, this.addr = ...
    this.addr = this.address = params.address;

    // This is setting the accessor defined above
    this.frequency = params.frequency || 100000; // 100khz

    // Send the ENABLE_I2C command when the first I2C device is instantiated
    if (!this.port.I2C.enabled) {
      this.port.command([CMD.ENABLE_I2C, this.baudrate]);
      // Note that this bus is enabled now
      this.port.I2C.enabled = true;
    }
  }

  static computeBaud(frequency) {
    // 15ns is max scl rise time
    // f = (48e6)/(2*(5+baud)+48e6*1.5e-8)
    const baud = Math.floor(((48e6 / frequency) - 48e6 * (1.5e-8)) / 2 - 5);

    return Math.max(0, Math.min(baud, 255));
  }

  send(data, callback) {
    this.port.cork();
    this.port.command([CMD.START, this.address << 1]);
    this.port.tx(data);
    this.port.command([CMD.STOP], callback);
    this.port.uncork();
  }

  read(length, callback) {
    this.port.cork();
    this.port.command([CMD.START, this.address << 1 | 1]);
    this.port.rx(length, callback);
    this.port.command([CMD.STOP]);
    this.port.uncork();
  }

  transfer(txbuf, rxlen, callback) {
    this.port.cork();
    /* istanbul ignore else */
    if (txbuf.length > 0) {
      this.port.command([CMD.START, this.address << 1]);
      this.port.tx(txbuf);
    }
    this.port.command([CMD.START, this.address << 1 | 1]);
    this.port.rx(rxlen, callback);
    this.port.command([CMD.STOP]);
    this.port.uncork();
  }
}


class SPI {
  constructor(params, port) {
    this.port = port;
    // Default the params if none were provided
    params = params || {};
    // default to pin 5 of the module port as cs
    this.chipSelect = params.chipSelect || this.port.digital[0];
    this.chipSelectActive = params.chipSelectActive === 'high' || params.chipSelectActive === 1 ? 1 : 0;

    if (this.chipSelectActive) {
      // active high, pull low for now
      this.chipSelect.low();
    } else {
      // active low, pull high for now
      this.chipSelect.high();
    }

    /* spi baud rate is set by the following equation:
     *  f_baud = f_ref/(2*(baud_reg+1))
     *  max baud rate is 24MHz for the SAMD21, min baud rate is 93750 without a clock divisor
     *  with a max clock divisor of 255, slowest clock is 368Hz unless we switch from 48MHz xtal to 32KHz xtal
     */
    // default is 2MHz
    this.clockSpeed = params.clockSpeed || 2e6;

    // if speed is slower than 93750 then we need a clock divisor
    if (this.clockSpeed < 368 || this.clockSpeed > 24e6) {
      throw new RangeError('SPI clock must be between 368Hz and 24MHz');
    }

    this._clockReg = Math.floor(48e6 / (2 * this.clockSpeed) - 1);

    // Find the smallest clock divider such that clockReg is <=255
    if (this._clockReg > 255) {
      // Find the clock divider, make sure its at least 1
      this._clockDiv = Math.floor(48e6 / (this.clockSpeed * (2 * 255 + 2)));

      // if the speed is still too low, set the clock divider to max and set baud accordingly
      // This condition will only be met when the clockSpeed parameter
      // is <= 366Hz, which is not possible given the Range condition
      // above: (368Hz-24MHz)
      /* istanbul ignore if*/
      if (this._clockDiv > 255) {
        this._clockReg = Math.floor(this._clockReg / 255) || 1;
        this._clockDiv = 255;
      } else {
        // if we can set a clock divider <255, max out clockReg
        this._clockReg = 255;
      }
    } else {
      this._clockDiv = 1;
    }

    if (typeof params.dataMode === 'number') {
      params.cpol = params.dataMode & 0x1;
      params.cpha = params.dataMode & 0x2;
    }

    this.cpol = params.cpol === 'high' || params.cpol === 1 ? 1 : 0;
    this.cpha = params.cpha === 'second' || params.cpha === 1 ? 1 : 0;

    this.port.command([CMD.ENABLE_SPI, this.cpol + (this.cpha << 1), this._clockReg, this._clockDiv]);
  }

  send(data, callback) {
    this.port.cork();
    this.chipSelect.low();
    this.port.tx(data, callback);
    this.chipSelect.high();
    this.port.uncork();
  }

  disable() {
    // Tell the coprocessor to disable this interface
    this.port.command([CMD.CMD_DISABLE_SPI]);
    // Unreference the previous SPI object

    priv.get(this.port).spi = undefined;
  }

  receive(length, callback) {
    this.port.cork();
    this.chipSelect.low();
    this.port.rx(length, callback);
    this.chipSelect.high();
    this.port.uncork();
  }

  transfer(data, callback) {
    this.port.cork();
    this.chipSelect.low();
    this.port.txrx(data, callback);
    this.chipSelect.high();
    this.port.uncork();
  }
}

class UART extends Duplex {
  constructor(options, port) {
    super({});

    let baudrate = 9600;

    Object.defineProperties(this, {
      baudrate: {
        get: () => {
          return baudrate;
        },
        set: (value) => {
          // baud is given by the following:
          // baud = 65536*(1-(samples_per_bit)*(f_wanted/f_ref))
          // samples_per_bit = 16, 8, or 3
          // f_ref = 48e6

          if (value < 9600 || value > 115200) {
            throw new Error('UART baudrate must be between 9600 and 115200');
          }

          baudrate = value;

          const computed = Math.floor(65536 * (1 - 16 * (baudrate / 48e6)));

          this.port.command([CMD.ENABLE_UART, computed >> 8, computed & 0xFF]);
        }
      }
    });

    this.port = port;
    this.baudrate = options.baudrate || 9600;
  }

  _write(chunk, encoding, callback) {
    // It appears that UART _write has always ignored the encoding argument.
    // This function is unused by this library code and appears only for
    // compatibility with T1 module code.

    if (!this.port.uart) {
      throw new Error('UART is not enabled on this port');
    }
    this.port.tx(chunk, callback);
  }

  _read() {}

  disable() {
    // Tell the coprocessor to disable this interface
    this.port.command([CMD.DISABLE_UART, 0, 0]);
    // Unreference this socket if there are no more items waiting on it
    // Specifically because it is asynchronous
    this.port.unref();
    // Unreference the previous uart object
    priv.get(this.port).uart = undefined;
  }
}


Vessel.I2C = I2C;
Vessel.Port = Port;
Vessel.Pin = Pin;
Vessel.SPI = SPI;
Vessel.UART = UART;

Vessel.Pin.ADC_PINS = ADC_PINS;
Vessel.Pin.INT_PINS = INT_PINS;
Vessel.Pin.INT_MODES = INT_MODES;
Vessel.Pin.PULL_PINS = PULL_PINS;
Vessel.Pin.PULL_MODES = PULL_MODES;
Vessel.Pin.PWM_PINS = PWM_PINS;

/* istanbul ignore else*/
if (process.env.IS_TEST_MODE) {
  Vessel.CMD = CMD;
  Vessel.REPLY = REPLY;
  Vessel.pwmBankSettings = pwmBankSettings;
  Vessel.pwmMinFrequency = PWM_MIN_FREQUENCY;
  Vessel.pwmMaxFrequency = PWM_MAX_FREQUENCY;
  Vessel.pwmPrescalars = PWM_PRESCALARS;
  Vessel.determineDutyCycleAndPrescalar = determineDutyCycleAndPrescalar;
}


process.on('exit', () => {
  /* istanbul ignore if*/
  if (Vessel.instance) {
    Vessel.instance.close();
  }
});

module.exports = Vessel;
