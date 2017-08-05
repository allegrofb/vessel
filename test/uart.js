var tessel = require('tessel'); // Import tessel

var port = tessel.port.A;
var uart = new port.UART({
  baudrate: 115200
});

uart.write('ahoy hoy\n')
uart.on('data', function (data) {
  console.log('received:', data);
})

// UART objects are streams!
// pipe all incoming data to stdout:
uart.pipe(process.stdout);



//sendData: {0ef62b100961686f7920686f790a020188}      
//ENABLE_UART: 14, 0x0e , f62b - // 1 byte for baud, 1 byte for mode
//  TX: 16,  0x10, 09 - tx size，tx content - 61686f7920686f790a
//020188





