
var tessel = require('tessel'); // Import tessel
var pin = tessel.port.A.pin[2]; // Select pin 2 on port A
pin.write(1, (error, buffer) => {
  if (error) {
    throw error;
  }

  console.log(buffer.toString('hex')); // Log the value written to the pin
});



//sent
//0402     //CMD.GPIO_HIGH, A.pin[2]
//020188   //this.sock.write(new Buffer([CMD.ECHO, 1, 0x88]));    等待反馈



//返回第一个字节

// const REPLY = {
  // ACK: 0x80,
  // NACK: 0x81,
  // HIGH: 0x82,
  // LOW: 0x83,
  // DATA: 0x84,

  // MIN_ASYNC: 0xA0,
  // ASYNC_PIN_CHANGE_N: 0xC0, // c0 to c8 is all async pin assignments
  // ASYNC_UART_RX: 0xD0
// };




