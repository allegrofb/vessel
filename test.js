
var request = require('request');



let header = {
"Content-type": "application/json; charset=UTF-8",
"Accept": "application/json; charset=UTF-8",
};

var j = request.jar()

let param = {'username': 'qwertyui','password': 'qwertyui'};
let options = {
	json: true,
	header : header,
	jar: j,
	body: param
};  
let url = 'http://192.168.56.101:4567/loginGadget';

request.post(url, options, function(error,httpResponse,body) {
	  
	if (!error && httpResponse.statusCode === 200) {
		//callback({success: true, msg: body});
		//console.log(httpResponse);
		//console.log(body);
		
		console.log('request is success ');

		var cookie_string = j.getCookieString(url); // "key1=value1; key2=value2; ..."
		var cookies = j.getCookies(url);  // [{key: 'key1', value: 'value1', domain: "www.google.com", ...}, ...]
		console.log(cookie_string);
		console.log(cookies);



		var io = require('socket.io-client');

		var reconnecting = false;

		var ioParams = {
			reconnectionAttempts: 5,
			reconnectionDelay: 1500,
			transports: ['polling', 'websocket'],
			path: '/socket.io',
			extraHeaders: { Cookie: cookie_string}
		};

		socket = io('http://192.168.56.101:4567', ioParams);

		socket.on('connect', onConnect);

		socket.on('reconnecting', onReconnecting);

		socket.on('disconnect', onDisconnect);

		socket.on('reconnect_failed', function () {
			console.log('reconnect_failed');
			
			// Wait ten times the reconnection delay and then start over
			//setTimeout(socket.connect.bind(socket), parseInt(config.reconnectionDelay, 10) * 10);
			setTimeout(socket.connect.bind(socket), 1500 * 10);
		});

		socket.on('checkSession', function (uid) {
			console.log('checkSession '+uid);
			
			// if (parseInt(uid, 10) !== parseInt(app.user.uid, 10)) {
				// //app.handleInvalidSession();
				// console.log('handleInvalidSession');
			// }
		});

		socket.on('event:banned', onEventBanned);

		socket.on('event:alert', ()=>{		console.log('event:alert');});

		function onConnect() {
			console.log('onConnect '+socket.sessionid);
			
			//app.isConnected = true;

			if (!reconnecting) {
				//app.showMessages();
				//$(window).trigger('action:connected');
			}

			if (reconnecting) {
				// var reconnectEl = $('#reconnect');
				// var reconnectAlert = $('#reconnect-alert');

				// reconnectEl.tooltip('destroy');
				// reconnectEl.html('<i class="fa fa-check"></i>');
				// reconnectAlert.fadeOut(500);
				reconnecting = false;

				reJoinCurrentRoom();

				socket.emit('meta.reconnected');

				// $(window).trigger('action:reconnected');

				setTimeout(function () {
					// reconnectEl.removeClass('active').addClass('hide');
				}, 3000);
			}
		}

		function reJoinCurrentRoom() {
			console.log('reJoinCurrentRoom');
			
			// var	url_parts = window.location.pathname.slice(config.relative_path.length).split('/').slice(1);
			// var room;

			// switch (url_parts[0]) {
			// case 'user':
				// room = 'user/' + (ajaxify.data ? ajaxify.data.theirid : 0);
				// break;
			// case 'topic':
				// room = 'topic_' + url_parts[1];
				// break;
			// case 'category':
				// room = 'category_' + url_parts[1];
				// break;
			// case 'recent':
				// room = 'recent_topics';
				// break;
			// case 'unread':
				// room = 'unread_topics';
				// break;
			// case 'popular':
				// room = 'popular_topics';
				// break;
			// case 'admin':
				// room = 'admin';
				// break;
			// case 'categories':
				// room = 'categories';
				// break;
			// }
			// app.currentRoom = '';
			// app.enterRoom(room);   //<-------------
		}

		function onReconnecting() {
			console.log('onReconnecting');
			
			reconnecting = true;
			// var reconnectEl = $('#reconnect');
			// var reconnectAlert = $('#reconnect-alert');

			// if (!reconnectEl.hasClass('active')) {
				// reconnectEl.html('<i class="fa fa-spinner fa-spin"></i>');
				// reconnectAlert.fadeIn(500).removeClass('hide');
			// }

			// reconnectEl.addClass('active').removeClass('hide').tooltip({
				// placement: 'bottom',
			// });
		}

		function onDisconnect() {
			console.log('onDisconnect');
			
			//$(window).trigger('action:disconnected');
			//app.isConnected = false;
		}

		function onEventBanned(data) {
			console.log('onEventBanned');		
			var message = data.until ? '[[error:user-banned-reason-until, ' + $.timeago(data.until) + ', ' + data.reason + ']]' : '[[error:user-banned-reason, ' + data.reason + ']]';

			// bootbox.alert({
				// title: '[[error:user-banned]]',
				// message: message,
				// closeButton: false,
				// callback: function () {
					// window.location.href = config.relative_path + '/';
				// },
			// });
		}



		socket.on('event:nodebb.ready', function (data) {
			console.log('event:nodebb.ready');
			console.log(JSON.stringify(data));
		});
		socket.on('event:livereload', function () {
			console.log('event:livereload');
		});
		socket.on('event:user_status_change', function (data) {
			console.log('event:user_status_change');
			console.log(JSON.stringify(data));
		});
		socket.on('event:new_post', function (data) {
			console.log('event:new_post');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_deleted', function (data) {
			console.log('event:topic_deleted');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_restored', function (data) {
			console.log('event:topic_restored');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_purged', function (data) {
			console.log('event:topic_purged');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_locked', function (data) {
			console.log('event:topic_locked');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_unlocked', function (data) {
			console.log('event:topic_unlocked');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_pinned', function (data) {
			console.log('event:topic_pinned');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_unpinned', function (data) {
			console.log('event:topic_unpinned');
			console.log(JSON.stringify(data));
		});
		socket.on('event:topic_moved', function (data) {
			console.log('event:topic_moved');
			console.log(JSON.stringify(data));
		});
		socket.on('event:new_topic', function (data) {
			console.log('event:new_topic');
			console.log(JSON.stringify(data));
		});
		socket.on('event:chats.edit', function (data) {
			console.log('event:chats.edit');
			console.log(JSON.stringify(data));
		});
		socket.on('event:unread.updateChatCount', function (data) {
			console.log('event:unread.updateChatCount');
			console.log(JSON.stringify(data));
		});
		socket.on('event:chats.receive', function (data) {
			console.log('event:chats.receive');
			console.log(JSON.stringify(data));
			
			
			
			
		});
		
		socket.on('event:gadget.receive', function (data) {
			console.log('event:gadget.receive');
			console.log(JSON.stringify(data));
			
			
			
			
		});
		
		socket.on('event:chats.roomRename', function (data) {
			console.log('event:chats.roomRename');
			console.log(JSON.stringify(data));
		});
		socket.on('event:new_notification', function (data) {
			console.log('event:new_notification');
			console.log(JSON.stringify(data));
		});
		socket.on('event:notifications.updateCount', function (data) {
			console.log('event:notifications.updateCount');
			console.log(JSON.stringify(data));
		});
		socket.on('event:sounds.reloadMapping', function () {
			console.log('event:sounds.reloadMapping');
		});
		socket.on('event:voted', function (data) {
			console.log('event:voted');
			console.log(JSON.stringify(data));
		});
		socket.on('event:bookmarked', function (data) {
			console.log('event:bookmarked');
			console.log(JSON.stringify(data));
		});
		socket.on('event:post_edited', function (data) {
			console.log('event:post_edited');
			console.log(JSON.stringify(data));
		});
		socket.on('event:post_purged', function (data) {
			console.log('event:post_purged');
			console.log(JSON.stringify(data));
		});
		socket.on('event:bookmark', function (data) {
			console.log('event:bookmark');
			console.log(JSON.stringify(data));
		});
		socket.on('event:unbookmark', function (data) {
			console.log('event:unbookmark');
			console.log(JSON.stringify(data));
		});
		socket.on('event:upvote', function (data) {
			console.log('event:upvote');
			console.log(JSON.stringify(data));
		});
		socket.on('event:downvote', function (data) {
			console.log('event:downvote');
			console.log(JSON.stringify(data));
		});
		socket.on('event:unvote', function (data) {
			console.log('event:unvote');
			console.log(JSON.stringify(data));
		});
		
		
	} else {
		console.log('request is error', error);
	}
	  
});


