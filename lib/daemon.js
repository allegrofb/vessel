const net = require('net');
const path = require('path');
const Duplex = require('stream').Duplex;
const util = require('util');
const log = require('./log');
const Emitter = require("events").EventEmitter;
	
class DeviceStream{
  constructor(device, simulator) {
	  
    this.simulator = simulator || false;
	this.buffer = new Buffer(0);
	
	if(this.simulator) {
		
		log.info('DeviceStream simulator mode');
		
		var PORT = 3000;
		var HOST = '127.0.0.1';

		// tcp客户端
		this.client = net.createConnection(path.join('\\\\?\\pipe', 'vessel-simulator'));

		this.client.on('connect', function(){
			console.log('客户端：已经与服务端建立连接');
		});

		this.client.on('data', function(data){
			console.log('客户端：收到服务端数据，内容为{'+ data +'}');
			this.buffer = Buffer.concat([this.buffer, data], this.buffer.length+data.length);
		});

		this.client.on('close', function(data){
			console.log('客户端：连接断开');
		});
	
	}
	else {
		const intf = device.interface(3); //?????
		this.epIn = intf.endpoints[0];
		this.epOut = intf.endpoints[1];
	}
  }

  write(chunk, callback) {
	  if(this.simulator) {
		  this.client.write(chunk, (error)=>{
			return callback(error);
		});
	  }
	  else {
		epOut.transfer(chunk, (error)=>{
			console.log('epOut.transfer error');
			return callback(error);
		});
		callback();
	  }
  }

  tryRead(size, callback) {
		
	if(this.buffer.length >= size) {
		callback(null,this.buffer.slice(0,size));
	}
	else {
		this.waitTimeout --;
		if(this.waitTimeout <= 0){
			callback(new Error('read timeout'));
			return;
		}
		setTimeout(() => { 
			this.tryRead(size, callback);
		}, 50); 
	}
  }
  
  read(size, callback) {
		if(this.simulator) {
			this.waitTimeout = 100;
			this.tryRead(size, callback);
		}
		else {
		 epIn.transfer(size, (error,data)=>{
			 if(error){
				console.log('epIn.transfer error');
				callback(error);
			 }
			 else {
				console.log('receiveHeader{'+ data.toString('hex') +'}');
				callback(error, data);
			 }
		 });
		}
  }
}

class DataStream extends Emitter {
  constructor(sock, port) {
    super();
	  
    this.sock = sock;
	this.port = port;
	
	this.sock.on('end', () => {
		console.log('client disconnected');
	});

	this.sock.on('data', function(data){
        console.log('服务端：收到客户端数据，内容为{'+ data.toString('hex') +'}');
		
		this.port.emit('data',data);
		
	});	
	
	this.port.on('output', function(data){
		this.sock.write(data);
	});
  }
}

class PortServer extends Emitter {
  constructor(deviceId, portId) {
    super();

	this.port = net.createServer();	

	this.port.on('connection', (c) => {
		console.log('client connected');
		this.client = new DataStream(c,this);
	});
	
	this.port.on('error', (err) => {
		console.log(portId+'error');
		throw err;
	});

	this.port.on('close', () => {

	});	
	
	this.port.listen(path.join('\\\\?\\pipe', deviceId, portId), () => {
		console.log(portId+' bound');
	});
  
  }
}


class USBDataDaemon extends Emitter {
	
  constructor(device, deviceId, simulator) {
    super();
	
	this.deviceStream = new DeviceStream(device, simulator);

	this.porta = new PortServer(deviceId, 'porta');
	this.portb = new PortServer(deviceId, 'portb');

	this.channels_writable_bitmask = 0;
	this.channels_opened_bitmask = 0;
    this.channel_usb = 0;
    this.channel_porta = 1;
    this.channel_portb = 2;
	this.buffer_porta_out_buf = new Buffer(0);
	this.buffer_portb_out_buf = new Buffer(0);

	this.porta_out_length = 0;
	this.portb_out_length = 0;
	this.retries = 0;
	this.header_receive_data = undefined;
	this.header_send_data = new Buffer(5);
	
	this.porta.on('data', () => {
		let length = buffer_porta_out_buf.length + data.length;
		buffer_porta_out_buf = Buffer.concat([buffer_porta_out_buf, data], length);
	});

	this.portb.on('data', () => {
		let length = buffer_portb_out_buf.length + data.length;
		buffer_portb_out_buf = Buffer.concat([buffer_portb_out_buf, data], length);
	});	

	this.on('sendHeader', () => {
		console.log('sendHeader');

		this.header_send_data.writeInt8(0x53, 0);
		this.header_send_data.writeInt8(this.channels_writable_bitmask | (this.channels_opened_bitmask << 4), 1);
		this.header_send_data.writeInt8(0, 2+this.channel_usb);
		this.header_send_data.writeInt8(this.porta_out_length, 2+this.channel_porta);
		this.header_send_data.writeInt8(this.portb_out_length, 2+this.channel_portb);

		console.log('sendHeader{'+ this.header_send_data.toString('hex') +'}');

	
		this.deviceStream.write(this.header_send_data, (error)=>{
			if(error){
				 setImmediate(() => {
				   this.emit('sendHeader', this);
				 });				
				 return;
			}
					
			this.deviceStream.read(5,(error,data)=>{
				
				if(error){
					log.error("read data timeout");
					setTimeout(() => { 
						this.emit('sendHeader', this);
					}, 5000); 
					return;
				}
					
				if (data.readInt8(0) != 0xCA) {
					retries++;

					if (retries > 15) {
						log.error("Too many retries, exiting");
					} 
					else {
						this.header_receive_data = data;
						this.emit('sendData', this);
					}
				}			  				
				
			});						
				
		});
	
     });

	this.on('sendData', () => {
		console.log('sendData');
			
		let buf = undefined;
		let totalLength = 0;
		let mask = this.header_receive_data.readInt8(1);
		let size = this.header_send_data.readInt8(2+channel_porta);
		if (mask & (1<<channel_porta) && size > 0) {
			totalLength += size;
			buf = Buffer.concat([buf, this.buffer_porta_out_buf.slice(0,size)], totalLength);
		}
			
		size = this.header_send_data.readInt8(2+channel_portb);
		if (mask & (1<<channel_portb) && size > 0) {
			totalLength += size;
			buf = Buffer.concat([buf, this.buffer_portb_out_buf.slice(0,size)], totalLength);
		}
		
		if(totalLength <= 0){
			
			let totalLength = 0;
			let size_a = header_receive_data.readInt8(2+channel_porta);
			let size_b = header_receive_data.readInt8(2+channel_portb);
			if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_porta) && size_a > 0) {
				totalLength += size;
			}

			if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_portb) && size_b > 0) {
				totalLength += size;
			}					
			
			if(totalLength > 0){
				
				this.deviceStream.read(totalLength,(error,data)=>{

					if(error) {
						
					}
					else {
				
						if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_porta) && size_a > 0) {
							this.porta.emit('output',data.slice(0,size_a));
						}			  
						if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_portb) && size_b > 0) {
							this.portb.emit('output',data.slice(0,size_b));
						}
					}
					
				});
			}				
			
			 setImmediate(() => {
			   this.emit('sendHeader', this);
			 });				
		}
		else {
			this.deviceStream.write(buf, (error)=>{
				if(error){
					 setImmediate(() => {
					   this.emit('sendHeader', this);
					 });				
					 return;
				}				
				else {
					
					let totalLength = 0;
					let size_a = header_receive_data.readInt8(2+channel_porta);
					let size_b = header_receive_data.readInt8(2+channel_portb);
					if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_porta) && size_a > 0) {
						totalLength += size;
					}

					if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_portb) && size_b > 0) {
						totalLength += size;
					}					
					
					if(totalLength > 0){
						
						this.deviceStream.read(totalLength,(error,data)=>{

							if(error) {
								
							}
							else {
						
								if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_porta) && size_a > 0) {
									this.porta.emit('output',data.slice(0,size_a));
								}			  
								if (get_channel_bitmask_state(this.channels_writable_bitmask, this.channel_portb) && size_b > 0) {
									this.portb.emit('output',data.slice(0,size_b));
								}
							}
							
						});
					}			

					 setImmediate(() => {
					   this.emit('sendHeader', this);
					 });							
					
				}
			});
		}
		
     });

     setImmediate(() => {
       this.emit('sendHeader', this);
     });
  }	
	
  set_channel_bitmask_state(bitmask,channel,state){
	if(state) {
		bitmask |= (1<<channel);
	}
	else {
        bitmask &= ~(1<<channel);
	}
  }

  get_channel_bitmask_state(bitmask, channel) {
    return ((bitmask) & (1 << channel)) ? true : false;
  }
	
	
}


// let daemonList = [];
// let foundTessel = false;
// let list = usb.getDeviceList();

// for (const i = 0; i < list.length; i++) {
	// const device = list[i];
	
    // if ((device.deviceDescriptor.idVendor === TESSEL_VID) && (device.deviceDescriptor.idProduct === TESSEL_PID)) {
	  // // Try to initialize interface
	  // const intf = device.interface(3); //?????
	  // try {
		// intf.claim();
		// epIn = intf.endpoints[0];
		// epOut = intf.endpoints[1];
		
		// daemonList.push(new USBDataDaemon(device,device.deviceDescriptor.iSerialNumber));
		
	  // } catch (e) {

		// console.log('interface claim failed: {'+ e.toString() +'}');
	  
		// return;
	  // }		
		
		// foundTessel = true;
		// break;
    // }
// }

// if(!foundTessel){
    // console.log('not found tessel!');
	// return;
// }
	
	
let daemonList = [];
daemonList.push(new USBDataDaemon(null,'fakedevice', true));
	

// var PORT = 3000;
// var HOST = '127.0.0.1';

// // tcp服务端
// var server = net.createServer(function(socket){
    // console.log('服务端：收到来自客户端的请求');

    // socket.on('data', function(data){
        // console.log('服务端：收到客户端数据，内容为{'+ data +'}');

        // // 给客户端返回数据
        // socket.write('你好，我是服务端');
    // });

    // socket.on('close', function(){
         // console.log('服务端：客户端连接断开');
    // });
// });
// server.listen(path.join('\\\\?\\pipe', 'tessel', 'port_a'), function(){
    // console.log('服务端：开始监听来自客户端的请求');
// });
	



