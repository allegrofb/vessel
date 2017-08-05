const net = require('net');
const path = require('path');

const BRIDGE_NUM_CHAN = 3;
const BRIDGE_USB = 0;
const BRIDGE_PORT_A = 1;
const BRIDGE_PORT_B = 2;
const BRIDGE_BUF_SIZE = 255;
const BRIDGE_ARG_SIZE = 5;

const MODE = {
    NONE : 0,
    SPI : 1,
    I2C : 2,
    UART : 3,
};

const PORT = {
    DISABLE : 0,
    READ_CMD : 1,
    READ_ARG : 2,
    EXEC : 3,
    EXEC_ASYNC : 4,
};

const PULL = {
    DOWN : 0,
    UP : 1,
    NONE : 2,
};

const EXEC = {
    DONE : PORT.READ_CMD,
    CONTINUE : PORT.EXEC,
    ASYNC : PORT.EXEC_ASYNC,
};

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


let PortAData = {
    /// Pin mappings
    //const TesselPort* port;

    /// Buffers for data from the host
    //USB_ALIGN u8 cmd_buf[BRIDGE_BUF_SIZE];
	cmd_buf: Buffer.alloc(BRIDGE_BUF_SIZE),

    /// Buffers for data to the host
    //USB_ALIGN u8 reply_buf[BRIDGE_BUF_SIZE];
	reply_buf: Buffer.alloc(BRIDGE_BUF_SIZE),
	
    /// Bridge channel
    //u8 chan;

    /// DMA channel for TX
    //DmaChan dma_tx;

    /// DMA channel for RX
    //DmaChan dma_rx;

    /// Parser state (PortState in port.c)
    //u8 state;
	state:PORT.READ_CMD,

    /// Port mode (SPI/UART/etc, PortMode in port.c)
    //u8 mode;
	mode: MODE.NONE,
	
    /// Length of valid data in cmd_buf
    //u8 cmd_len;
	cmd_len:0,
	
    /// Current position in cmd_buf
    //u8 cmd_pos;
	cmd_pos:0,

    /// Current write position in reply_buf (length of valid data written)
    //u8 reply_len;
	reply_len:0,

    /// Currently executing command (PortCmd in port.c)
    //u8 cmd;
	cmd:0,

    /// Parsed arguments
    //u8 arg[BRIDGE_ARG_SIZE];
	arg:Buffer.alloc(BRIDGE_ARG_SIZE),

    /// Length of arguments
    //u8 arg_len;
	arg_len:0,

    /// Position into arguments
    //u8 arg_pos;
	arg_pos:0,

    /// GCLK channel for this port
    //u8 clock_channel;

    /// TCC channel for this port
    //u8 tcc_channel;

    /// True if the port is waiting for a packet from the host
    //bool pending_out;
	pending_out:true,

    /// True if the port is sending a packet to the host
    //bool pending_in;
	pending_in: false,
    //UartBuf uart_buf;
};

let PortBData = {
    /// Pin mappings
    //const TesselPort* port;

    /// Buffers for data from the host
    //USB_ALIGN u8 cmd_buf[BRIDGE_BUF_SIZE];
	cmd_buf: Buffer.alloc(BRIDGE_BUF_SIZE),

    /// Buffers for data to the host
    //USB_ALIGN u8 reply_buf[BRIDGE_BUF_SIZE];
	reply_buf: Buffer.alloc(BRIDGE_BUF_SIZE),
	
    /// Bridge channel
    //u8 chan;

    /// DMA channel for TX
    //DmaChan dma_tx;

    /// DMA channel for RX
    //DmaChan dma_rx;

    /// Parser state (PortState in port.c)
    //u8 state;
	state:PORT.READ_CMD,

    /// Port mode (SPI/UART/etc, PortMode in port.c)
    //u8 mode;
	mode: MODE.NONE,
	
    /// Length of valid data in cmd_buf
    //u8 cmd_len;
	cmd_len:0,
	
    /// Current position in cmd_buf
    //u8 cmd_pos;
	cmd_pos:0,

    /// Current write position in reply_buf (length of valid data written)
    //u8 reply_len;
	reply_len:0,

    /// Currently executing command (PortCmd in port.c)
    //u8 cmd;
	cmd:0,

    /// Parsed arguments
    //u8 arg[BRIDGE_ARG_SIZE];
	arg:Buffer.alloc(BRIDGE_ARG_SIZE),

    /// Length of arguments
    //u8 arg_len;
	arg_len:0,

    /// Position into arguments
    //u8 arg_pos;
	arg_pos:0,

    /// GCLK channel for this port
    //u8 clock_channel;

    /// TCC channel for this port
    //u8 tcc_channel;

    /// True if the port is waiting for a packet from the host
    //bool pending_out;
	pending_out:true,

    /// True if the port is sending a packet to the host
    //bool pending_in;
	pending_in:false,
    //UartBuf uart_buf;
};

/// Returns the number of argument bytes for the specified command
const port_cmd_args = function (cmd) {
    switch (cmd) {
        case CMD.NOP:
        case CMD.FLUSH:
        case CMD.DISABLE_SPI:
        case CMD.DISABLE_I2C:
        case CMD.DISABLE_UART:
        case CMD.STOP:
            return 0;

        // Length argument:
        case CMD.ECHO:
        case CMD.TX:
        case CMD.RX:
        case CMD.TXRX:
            return 1;

        // Pin argument:
        case CMD.GPIO_IN:
        case CMD.GPIO_HIGH:
        case CMD.GPIO_LOW:
        case CMD.GPIO_TOGGLE:
        case CMD.GPIO_WAIT:
        case CMD.GPIO_INT:
        case CMD.GPIO_CFG:
        case CMD.GPIO_INPUT:
        case CMD.GPIO_RAW_READ:
        case CMD.ANALOG_READ:
        case CMD.GPIO_PULL:
            return 1;

        case CMD.ANALOG_WRITE:
            return 2;

        // Config argument:
        case CMD.ENABLE_SPI:
            // 1 byte for mode, 1 byte for freq, 1 byte for div
            return 3;
        case CMD.ENABLE_I2C:
            // 1 byte for freq
            return 1;
        case CMD.ENABLE_UART:
            return 2; // 1 byte for baud, 1 byte for mode
        case CMD.START:
            return 1; // 1 byte for addr
        case CMD.PWM_DUTY_CYCLE:
            return 3; // 1 byte for pin, 2 bytes for duty cycle
        case CMD.PWM_PERIOD:
            return 3; // 1 byte for tcc id & prescalar, 2 bytes for period
    }
	console.log('invalid cmd '+cmd);
    return 0;
}


/// Enqueue a byte on the reply buf. Requires that at least one byte of space is available.
const port_send_status = function(p, d) {
    if (p.reply_len >= BRIDGE_BUF_SIZE) {
        console.log('error');
        return;
    }
    p.reply_buf[p.reply_len++] = d;
}


/// Begin execution of a command. This function performs the setup for commands with payloads,
/// or the entire execution for commands that do not have payloads.
///   EXEC_DONE: move on to the next command
///   EXEC_CONTINUE: schedule port_continue_command to be called with a part of the payload when
///                  available
const port_begin_cmd = function(p) {
    switch (p.cmd) {
        case CMD.NOP:
            return EXEC.DONE;

        case CMD.ECHO:
        case CMD.RX:
        case CMD.TXRX:
            port_send_status(p, REPLY.DATA);
            return EXEC.CONTINUE;

        case CMD.TX:
            return EXEC.CONTINUE;                 

        case CMD.GPIO_IN:
            //pin_in(port_selected_pin(p));
            //u8 state = pin_read(port_selected_pin(p));
			console.log('CMD.GPIO_IN ' + p.arg[0] % 8);
			let state = 1;
            port_send_status(p, state ? REPLY.HIGH : REPLY.LOW);
            return EXEC.DONE;

        case CMD.GPIO_INPUT:
            //pin_in(port_selected_pin(p));
			console.log('CMD.GPIO_INPUT ' + p.arg[0] % 8);
            return EXEC.DONE;

        case CMD.GPIO_RAW_READ:
            //port_send_status(p, pin_read(port_selected_pin(p)) ? REPLY.HIGH : REPLY.LOW);
			console.log('CMD.GPIO_RAW_READ' + p.arg[0] % 8);
            port_send_status(p, REPLY.HIGH);
            return EXEC.DONE;

        case CMD.GPIO_HIGH:
            //pin_high(port_selected_pin(p));
            //pin_out(port_selected_pin(p));
			console.log('CMD.GPIO_HIGH' + p.arg[0] % 8);
            return EXEC.DONE;

        case CMD.GPIO_LOW:
            //pin_low(port_selected_pin(p));
            //pin_out(port_selected_pin(p));
			console.log('CMD.GPIO_LOW' + p.arg[0] % 8);
            return EXEC.DONE;

        case CMD.GPIO_TOGGLE:
            //pin_toggle(port_selected_pin(p));
            //pin_out(port_selected_pin(p));
			console.log('CMD.GPIO_TOGGLE' + p.arg[0] % 8);
            return EXEC.DONE;

        case CMD.GPIO_PULL: {
            // Extract the pin number
            let pin = p.arg[0] & 0x7;
            // Extract the type of pull
            let mode = (p.arg[0] >> 4);

            // Based on the type of pull
            switch(mode) {
                case PULL.DOWN:
                    // Explicitly pull down that pin
                    //pin_pull_down(p.port->gpio[pin]);
					console.log('CMD.GPIO_PULL DOWN' + pin);					
                    return EXEC.DONE;

                case PULL.UP:
                    // Explicitly pull up that pin
                    //pin_pull_up(p.port->gpio[pin]);
					console.log('CMD.GPIO_PULL UP' + pin);					
                    return EXEC.DONE;

                case PULL.NONE:
                    // Just let that pin float
                    //pin_float(p.port->gpio[pin]);
					console.log('CMD.GPIO_PULL NONE' + pin);					
                    return EXEC.DONE;

                default:
                    return EXEC.DONE;
            }
        }

        case CMD.GPIO_INT: {
            let pin = p.arg[0] & 0x7;
            let mode = (p.arg[0] >> 4) & 0x07;
			console.log('CMD.GPIO_INT ' + pin);					

            // if (port_pin_supports_interrupt(p, pin)) {
                // // If we are setting an interrupt
                // if (mode != 0) {
                    // // Ensure the pin is configured as an external interrupt
                    // pin_mux_eic(p.port->gpio[pin]);
                    // // Set the type of interrupt we need (ie low, fall, etc.)
                    // eic_config(p.port->gpio[pin], mode);
                // // If we are removing interrupts
                // } else {
                    // // First disable the interrupts
                    // eic_config(p.port->gpio[pin], mode);
                    // // Then set the pin back as GPIO
                    // // It is important to do this in the above order to avoid
                    // // the case where the interrupt is disabled and pin set as
                    // // GPIO in one call, and the interrupt enabled in the next
                    // // (which could immediately fire depending on GPIO state)
                    // pin_gpio(p.port->gpio[pin]);
                // }
            // }

            return EXEC.DONE;
        }

        case CMD.GPIO_WAIT:
        case CMD.GPIO_CFG:
            return EXEC.DONE;

        case CMD.ANALOG_READ: {
            // copy analog data into reply buffer
            //u16 val = adc_read(port_selected_pin(p), ADC_INPUTCTRL_GAIN_DIV2);
			console.log('CMD.ANALOG_READ');
			let val = 0x1234;
			
            p.reply_buf[p.reply_len++] = REPLY.DATA;
            p.reply_buf[p.reply_len++] = val & 0xFF; // lower 8 bits
            p.reply_buf[p.reply_len++] = val >> 8;// higher 8 bits

            return EXEC.DONE;
        }

        case CMD.ANALOG_WRITE:
            // get the higher and lower args
            //dac_write(PORT_B.g3, (p.arg[0] << 8) + p.arg[1]);
			console.log('CMD.ANALOG_WRITE PORT_B.g3 ='+ ((p.arg[0] << 8) + p.arg[1]));
            return EXEC.DONE;

        case CMD.ENABLE_SPI:
			console.log('CMD.ENABLE_SPI');
		
            // // set up clock in case we need to use a divider
            // sercom_clock_enable(p.port->spi, p.clock_channel, p.arg[2]);
            // // can only do spi master
            // sercom_spi_master_init(p.port->spi, p.port->spi_dipo, p.port->spi_dopo,
                // !!(p.arg[0] & FLAG_SPI_CPOL), !!(p.arg[0] & FLAG_SPI_CPHA), p.arg[1]);
            // dma_sercom_configure_tx(p.dma_tx, p.port->spi);
            // dma_sercom_configure_rx(p.dma_rx, p.port->spi);
            // dma_enable_interrupt(p.dma_rx);
            // pin_mux(p.port->mosi);
            // pin_mux(p.port->miso);
            // pin_mux(p.port->sck);
            p.mode = MODE.SPI;
            return EXEC.DONE;

        case CMD.DISABLE_SPI:
			console.log('CMD.DISABLE_SPI');
            // TODO: disable SERCOM
            // pin_gpio(p.port->mosi);
            // pin_gpio(p.port->miso);
            // pin_gpio(p.port->sck);
            p.mode = MODE.NONE;
            return EXEC.DONE;

        case CMD.ENABLE_I2C:
			console.log('CMD.ENABLE_I2C');
            // sercom_i2c_master_init(p.port->uart_i2c, p.arg[0]);
            // pin_mux(p.port->sda);
            // pin_mux(p.port->scl);
            // sercom(p.port->uart_i2c)->I2CM.INTENSET.reg = SERCOM_I2CM_INTENSET_ERROR;
            p.mode = MODE.I2C;
            return EXEC.DONE;

        case CMD.DISABLE_I2C:
			console.log('CMD.DISABLE_I2C');
            // pin_gpio(p.port->sda);
            // pin_gpio(p.port->scl);
            p.mode = MODE.NONE;
            return EXEC.DONE;

        case CMD.START:
			console.log('CMD.START');
            // while(sercom(p.port->uart_i2c)->I2CM.SYNCBUSY.bit.SYSOP) {}
            // sercom(p.port->uart_i2c)->I2CM.ADDR.reg = p.arg[0];
            // if (p.arg[0] & 1)  {
                // sercom(p.port->uart_i2c)->I2CM.INTENSET.reg = SERCOM_I2CM_INTENSET_SB; // Read
            // } else {
                // sercom(p.port->uart_i2c)->I2CM.INTENSET.reg = SERCOM_I2CM_INTENSET_MB; // Write
            // }
            p.arg[0] = 0;
            return EXEC.ASYNC;

        case CMD.STOP:
			console.log('CMD.STOP');
            // sercom(p.port->uart_i2c)->I2CM.CTRLB.bit.ACKACT = 1;
            // sercom(p.port->uart_i2c)->I2CM.CTRLB.bit.CMD = 3;
            return EXEC.DONE;

        case CMD.ENABLE_UART:
			console.log('CMD.ENABLE_UART');
		
            // set up uart
            // pin_mux(p.port->tx);
            // pin_mux(p.port->rx);
            // sercom_uart_init(p.port->uart_i2c, p.port->uart_dipo,
                // p.port->uart_dopo, (p.arg[0] << 8) + p.arg[1]); // 63019
            // dma_sercom_configure_tx(p.dma_tx, p.port->uart_i2c);
            // dma_enable_interrupt(p.dma_tx);

            p.mode = MODE.UART;

            // p.uart_buf.head = 0;
            // p.uart_buf.tail = 0;
            // p.uart_buf.buf_len = 0;
            // // set up interrupt on uart receive data complete
            // sercom(p.port->uart_i2c)->USART.INTENSET.reg = SERCOM_USART_INTFLAG_RXC;

            // // set up interrupt timer so that uart data will get written on timeout
            // tcc_delay_enable(p.tcc_channel);

            return EXEC.DONE;

        case CMD.DISABLE_UART:
			console.log('CMD.DISABLE_UART');
		
            p.mode = MODE.NONE;
            // sercom(p.port->uart_i2c)->USART.INTENCLR.reg = SERCOM_USART_INTFLAG_RXC;
            // tcc_delay_disable(p.tcc_channel);
            // pin_gpio(p.port->tx);
            // pin_gpio(p.port->rx);
            return EXEC.DONE;

        case CMD.PWM_DUTY_CYCLE: {
            // The pin number is the first argument
            let pin = p.arg[0];
            // Duty cycle is next two bytes
            let duty_cycle = (p.arg[1] << 8) + p.arg[2];
            // Set the duty cycle on the pin
            // pwm_set_pin_duty(p.port->gpio[pin], duty_cycle);
			console.log('CMD.PWM_DUTY_CYCLE '+pin+' '+duty_cycle);
			
            return EXEC.DONE;
        }
        case CMD.PWM_PERIOD: {
            // The TCC to use is first 4 bits
            let tcc_id = (p.arg[0] & 0x7);
            // The TCC prescalar is next 4 bits
            let prescalar = (p.arg[0] >> 4);
            // The TCC period is next 2 bytes
            let period = (p.arg[1] << 8) + p.arg[2];
            // Set the period on the bank
            // pwm_bank_set_period(tcc_id, prescalar, period);
			console.log('CMD.PWM_DUTY_CYCLE '+tcc_id+' '+prescalar+' '+period);
			
            return EXEC.DONE;
        }
    }
    console.log('port_begin_cmd error');
    return EXEC.DONE;
}



/// Calculate the number of bytes that can immediately be processed for a TXRX command
const port_txrx_len = function(p) {
    let size = p.arg[0];
    let cmd_remaining = p.cmd_len - p.cmd_pos;
    if (cmd_remaining < size) {
        size = cmd_remaining;
    }
    let reply_remaining = BRIDGE_BUF_SIZE - p.reply_len;
    if (reply_remaining < size) {
        size = reply_remaining;
    }
    return size;
}

/// Called to process the payload of a command. It is not guaranteed that the full payload will
/// be available in one chunk, so this function is called on events until it returns EXEC_DONE.
const port_continue_cmd = function(p) {
    switch (p.cmd) {
        case CMD.ECHO: {
			console.log('CMD.ECHO');
            let size = port_txrx_len(p);
            // memcpy(&p.reply_buf[p.reply_len], &p.cmd_buf[p.cmd_pos], size);
			p.cmd_buf.copy(p.reply_buf,p.reply_len,p.cmd_pos,p.cmd_pos+size);
            p.reply_len += size;
            p.cmd_pos += size;
            p.arg[0] -= size;
            return p.arg[0] == 0 ? EXEC.DONE : EXEC.CONTINUE;
        }
        case CMD.TX:
			console.log('CMD.TX');
		
            if (p.mode == MODE.SPI) {
                // u32 size = port_tx_len(p);
                // dma_sercom_start_rx(p.dma_rx, p.port->spi, NULL, size);
                // dma_sercom_start_tx(p.dma_tx, p.port->spi, &p.cmd_buf[p.cmd_pos], size);
                // p.cmd_pos += size;
                // p.arg[0] -= size;
            } else if (p.mode == MODE.I2C) {
                // while(sercom(p.port->uart_i2c)->I2CM.SYNCBUSY.bit.SYSOP) {}
                // sercom(p.port->uart_i2c)->I2CM.DATA.reg = p.cmd_buf[p.cmd_pos];
                // p.cmd_pos += 1;
                // p.arg[0] -= 1;
                // sercom(p.port->uart_i2c)->I2CM.INTENSET.reg = SERCOM_I2CM_INTENSET_MB;
            } else if (p.mode == MODE.UART) {
                // u32 size = port_tx_len(p);
                // // start dma transfer
                // // dma_sercom_start_rx(p.dma_rx, p.port->uart_i2c, NULL, size);
                // dma_sercom_start_tx(p.dma_tx, p.port->uart_i2c, &p.cmd_buf[p.cmd_pos], size);
                // p.cmd_pos += size;
                // p.arg[0] -= size;
            }
            return EXEC.ASYNC;
        case CMD.RX:
			console.log('CMD.RX');
		
            if (p.mode == MODE.SPI) {
                // u32 size = port_rx_len(p);
                // dma_sercom_start_rx(p.dma_rx, p.port->spi, &p.reply_buf[p.reply_len], size);
                // dma_sercom_start_tx(p.dma_tx, p.port->spi, NULL, size);
                // p.reply_len += size;
                // p.arg[0] -= size;
            } else if (p.mode == MODE.I2C) {
                // p.reply_buf[p.reply_len] = sercom(p.port->uart_i2c)->I2CM.DATA.reg;
                // sercom(p.port->uart_i2c)->I2CM.CTRLB.bit.ACKACT = 0;
                // while(sercom(p.port->uart_i2c)->I2CM.SYNCBUSY.bit.SYSOP) {}
                // sercom(p.port->uart_i2c)->I2CM.CTRLB.bit.CMD = 2;
                // p.reply_len += 1;
                // p.arg[0] -= 1;
                // sercom(p.port->uart_i2c)->I2CM.INTENSET.reg = SERCOM_I2CM_INTENSET_SB;
            }
            return EXEC.ASYNC;
        case CMD.TXRX:
			console.log('CMD.TXRX');
		
            if (p.mode == MODE.SPI) {
                // u32 size = port_txrx_len(p);
                // dma_sercom_start_rx(p.dma_rx, p.port->spi, &p.reply_buf[p.reply_len], size);
                // dma_sercom_start_tx(p.dma_tx, p.port->spi, &p.cmd_buf[p.cmd_pos], size);
                // p.reply_len += size;
                // p.cmd_pos += size;
                // p.arg[0] -= size;
            }
            return EXEC.ASYNC;
    }
    return EXEC.DONE;
}



// Returns true if the TX buffer is in use in the PORT_EXEC_ASYNC state of the current command
const port_tx_locked = function(p) {
    switch (p.cmd) {
        case CMD.RX:
            return false;
        default:
            return true;
    }
}

// Returns true if the RX buffer is in use in the PORT_EXEC_ASYNC state of the current command
const port_rx_locked = function(p) {
    switch (p.cmd) {
        case CMD.TX:
            return false;
        default:
            return true;
    }
}


/// Return true if the port is in a state where it can handle asyncronous events
const port_async_events_allowed = function(p) {
    if (!p.pending_in) {
        if (p.state == PORT.READ_CMD) return true;

        // TX doesn't touch reply_buf, so it is safe to process async events while it is sending.
        // This is needed for UART loopback.
        if (p.state == PORT.EXEC_ASYNC && !port_rx_locked(p)) return true;
    }
    return false;
}

/// Step the state machine. This is the main dispatch function of the port control logic.
/// This gets called after an event occurs to decide what happens next.
const port_step = function(p) {


    while (1) {
        // If the command buffer has been processed, request a new one
        if (p.cmd_pos >= p.cmd_len && !p.pending_out && !(p.state == PORT.EXEC_ASYNC && port_tx_locked(p))) {
            p.pending_out = true;
            //port_bridge_start_out(p, p.cmd_buf);
        }
        // If the reply buffer is full, flush it.
        // Or, if there is any data and no commands, might as well flush.
        if ((p.reply_len >= BRIDGE_BUF_SIZE || (p.pending_out && p.reply_len > 0))
           && !p.pending_in && !(p.state == PORT.EXEC_ASYNC && port_rx_locked(p))) {
            p.pending_in = true;
            //port_bridge_start_in(p, p.reply_buf, p.reply_len);
        }

        // Wait for bridge transfers to complete;
        // TODO: multiple-buffer FIFO
        if (p.pending_in || p.pending_out) {
            if (port_async_events_allowed(p)) {
                // If we're waiting for further commands, also
                // wait for async events.
                //port_enable_async_events(p);
            }
            break;
        };

        if (p.state == PORT.READ_CMD) {
            // Read a command byte and look up how many argument bytes it needs
            p.cmd = p.cmd_buf[p.cmd_pos++];
            p.arg_len = port_cmd_args(p.cmd);

            if (p.arg_len > 0) {
                p.arg_pos = 0;
                p.state = PORT.READ_ARG;
            } 
			else {
                p.state = port_begin_cmd(p);
            }
        } 
		else if (p.state == PORT.READ_ARG) {
            // Read an argument byte
            if (p.arg_len == 0) {
                console.log('p.arg_len == 0 error');
                return;
            }
            p.arg[p.arg_pos++] = p.cmd_buf[p.cmd_pos++];
            p.arg_len--;

            if (p.arg_len == 0) {
                p.state = port_begin_cmd(p);
            }
        } 
		else if (p.state == PORT.EXEC) {
            p.state = port_continue_cmd(p);
        } 
		else if (p.state == PORT.EXEC_ASYNC) {
            break;
        }
    }
}


const SERVER = {
    HEADER : 0,
    DATA : 1,
};

let ServerData = {
	mode:SERVER.HEADER,
	header_in:Buffer.alloc(5),
	header_out:Buffer.alloc(5),
	data_in:Buffer.alloc(0),
	data_out:Buffer.alloc(0),
	data_out_buf:Buffer.alloc(BRIDGE_BUF_SIZE),
};

const server_step = function(p,data,sock) {   //port_continue_cmd may be bug here, it should conside multiple payload
	if(p.mode == SERVER.HEADER) {
		if(data.length == 5 && data.readInt8(0) == 0x53){          
			p.header_in = data;
			console.log('received Header {'+p.header_in.toString('hex') +'}');
			
			if(p.header_in.readUInt8(2+BRIDGE_PORT_A) > 0 || p.header_in.readUInt8(2+BRIDGE_PORT_B) > 0) {
				p.mode = SERVER.DATA;
			}
			
			p.header_out.writeUInt8(0xca,0);
			p.header_out.writeUInt8(0,1);
			p.header_out.writeUInt8(0,2+BRIDGE_USB);
			p.header_out.writeUInt8(PortAData.reply_len,2+BRIDGE_PORT_A);
			p.header_out.writeUInt8(PortBData.reply_len,2+BRIDGE_PORT_B);

			if(PortAData.reply_len > 0 || PortBData.reply_len > 0) {
				let len = 0;
				if(PortAData.reply_len > 0) {
					PortAData.reply_buf.copy(p.data_out_buf, 0, 0, PortAData.reply_len);
					len += PortAData.reply_len;
					PortAData.reply_len = 0;
					PortAData.pending_in = false
				}
				if(PortBData.reply_len > 0) {
					PortBData.reply_buf.copy(p.data_out_buf, PortAData.reply_len, 0, PortBData.reply_len);
					len += PortBData.reply_len;					
					PortBData.reply_len = 0;
					PortBData.pending_in = false
				}
				p.data_out = p.data_out_buf.slice(0,len);
				console.log('try to sendData {'+p.data_out.toString('hex') +'}');
			}
			console.log('sendHeader {'+p.header_out.toString('hex') +'}');
			sock.write(p.header_out, ()=>{
				if(p.data_out.length > 0) {
					console.log('sendData {'+p.data_out.toString('hex') +'}');
					sock.write(p.data_out,()=>{
						p.data_out = Buffer.alloc(0);
					});
				}
			});
		}
		else {
			console.log('SERVER.HEADER error {'+data.toString('hex') +'}');
		}
	}
	else {
		console.log('received Data {'+data.toString('hex') +'}');
		
		let size_a = p.header_in.readUInt8(2+BRIDGE_PORT_A);
		let size_b = p.header_in.readUInt8(2+BRIDGE_PORT_B);
		
		p.data_in = Buffer.concat([p.data_in,data]);
		if(p.data_in.length >= size_a + size_b) {
			p.mode = SERVER.HEADER;
			if(size_a > 0) {
				PortAData.cmd_buf = data.slice(0,size_a);
				PortAData.cmd_len = size_a;
				PortAData.cmd_pos = 0;
				PortAData.pending_out = false;
				port_step(PortAData);
			}
			if(size_b > 0) {
				PortBData.cmd_buf = data.slice(size_a,size_b);
				PortBData.cmd_len = size_b;
				PortBData.cmd_pos = 0;
				PortBData.pending_out = false;
				port_step(PortBData);
			}
			p.data_in = Buffer.alloc(0);
		}
	}
}

// tcp服务端
var server = net.createServer(function(socket){
    console.log('服务端：收到来自客户端的请求');

    socket.on('data', function(data){
        console.log('服务端：收到客户端数据，内容为{'+ data.toString('hex') +'}');

		server_step(ServerData, data, socket);
		
		// if(data.length == 5 && data.readInt8(0) == 0x53){
			// let buffer = Buffer.alloc(5);
			// buffer.writeUInt8(0xCA,0);
			// console.log('服务端：发送内容为{'+ buffer.toString('hex') +'}');
			// socket.write(buffer);
		// }
    });

    socket.on('close', function(){
         console.log('服务端：客户端连接断开');
    });
});

server.listen(path.join('\\\\?\\pipe', 'vessel-simulator'), function(){
    console.log('服务端：开始监听来自客户端的请求');
});


