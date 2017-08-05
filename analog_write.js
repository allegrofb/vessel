
var tessel = require('tessel'); // Import tessel
var pin = tessel.port.B.pin[7]; // Select pin 7 on port B
pin.analogWrite(0.6);  // Turn pin to 60% of high voltage


//received Data {190265}      ANALOG_READ: 24, 0x19
//CMD.ANALOG_WRITE PORT_B.g3 =613       0x0265



