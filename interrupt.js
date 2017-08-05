
var tessel = require('tessel'); // Import tessel

var pin2 = tessel.port.A.pin[2];

// Register an event. When the voltage on pin2 rises, turn on the green LED.
pin2.on('rise', function() {
  console.log('tessel.port.A.pin[2] rise happend');
});



//sendData: {0812}
//received data: {ca}
