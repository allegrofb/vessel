
var tessel = require('tessel'); // Import tessel
var pin = tessel.port.A.pin[2]; // Select pin 2 on port A
pin.read(function(error, number) {
  if (error) {
    throw error;
  }

  console.log(number); // 1 if "high", 0 if "low"
});





//sendData: {0302}
//received data: {82}


