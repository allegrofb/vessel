
var tessel = require('tessel'); // Import tessel
var pin = tessel.port.A.pin[4]; // Select pin 4 on port A
pin.analogRead((error, number) => {
  if (error) {
    throw error;
  }

  console.log(number); // The number is a value between 0 and 1
});



//sendData: {1804}
//received data: {843412}


