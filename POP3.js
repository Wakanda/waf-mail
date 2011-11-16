/* Copyright (c) 4D, 2011
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// POP3 library.
//
// Usage:
//
//		Use getAllMailAndDelete() or getAllMail() functions to retrieve all available mails on a POP3 server.
//		getAllMail() will left them on server. This is the most common use case. 
//
//		For more control, create a POP3 object, connect it to a server, and issue individual commands. You may 
//		find out the number of message(s) available for read, their individual sizes, etc.
//		
//		If you need even more control and are familiar with POP3 protocol, use the POP3Client low-level library.

function POP3Scope () {

	var DEFAULT_PORT			= 110;

	var STATES = {
		
		NOT_CONNECTED:			1,	// State just after creation.
		IDLE:					2,	// Connected to POP3 server, awaiting commands.		
		AUTHENTIFICATION:		3,	// USER then PASS commands authentification.
		WAITING_REPLY:			4,	// Command sent, waiting response from server.
		TERMINATED:				5,	// Has sent QUIT command.
		
		CONNECTION_BROKEN:		-1,	// Connection has been lost.
			
	};
	
	var isWakanda	= typeof requireNative != 'undefined';
	var pop3		= isWakanda ? require('waf-mail/pop3Client') : require('./pop3Client.js');
	
	// Exception for POP3, see codes below.
	
	var POP3Exception = function (code) {
	
		this.code = code;
	
	}
	POP3Exception.INVALID_STATE		= -1;	// Command or operation can't be performed in current state.
	POP3Exception.INVALID_ARGUMENT	= -2;	// At least an argument is wrong.
	
	// If arguments are given, connect to server on object's creation.
	
	function POP3 (address, port, isSSL, callback) {
				
		var state		= STATES.NOT_CONNECTED;
		var pop3Client	= new pop3.POP3Client();
		
		this.POP3Exception = POP3Exception;
		
		// Connect to a POP3 server. 
		
		this.connect = function (address, port, isSSL, callback) {
			
			if (state != STATES.NOT_CONNECTED)
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			if (typeof address != 'string') 
			
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
							
			if (typeof port == 'undefined') 
				
				port = DEFAULT_PORT;
				
			else if (typeof port == 'string') 
				
				port = port.toNumber();
					
			else if (typeof port != 'number') 
				
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
				
			var	connectFunction = isSSL ? pop3Client.sslConnect : pop3Client.connect;
			
			connectFunction(address, port, function (isOkResponse, response) {

				state = STATES.IDLE;
				if (typeof callback == 'function')
				
					callback(isOkResponse == 0, response);	// Server's greeting in response.

			});
			
		}
		
		var authenticatePassword, authenticateCallback;
		
		var sendPasswordCallback = function (isOkResponse, response) {
		
			if (isOkResponse != 0) {
			
				state = STATES.IDLE;
				if (typeof authenticateCallback == 'function')
				
					authenticateCallback(false, response);				
			
			} else {
			
				pop3Client.sendPASS(authenticatePassword, function (isOkResponse, response) {
				
					state = STATES.IDLE;
					if (typeof authenticateCallback == 'function')
				
						authenticateCallback(isOkResponse == 0, response);

				});
				
			}
		
		}
				
		// Authenticate using USER and PASS commands, username and password arguments are mandatory. Callback is 
		// called with a boolean as first argument, indicating if authentification was successful. Second argument
		// is the response from server for PASS command if successful. Or first command (either USER or PASS) to 
		// fail.
		
		this.authenticate = function (username, password, callback) {
		
			if (state != STATES.IDLE) 
		
				throw new POP3Exception(POP3Exception.INVALID_STATE);
		
			else if (typeof username != 'string' || typeof password != 'string')
			
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
				
			else {

				authenticatePassword = password;
				authenticateCallback = callback;
				
				state = STATES.AUTHENTIFICATION;
				pop3Client.sendUSER(username, sendPasswordCallback);
			
			}
		
		}
		
		// Get 'status' of POP3 server. If successful, callback has as additional arguments the number of message(s)
		// available for read and the total size of mail box. 
		
		this.getStatus = function (callback) {
				
			if (state != STATES.IDLE) 
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
		
			state = STATES.WAITING_REPLY;
			pop3Client.sendSTAT(function (isOkResponse, response, numberMessages, totalSize) {
			
				state = STATES.IDLE;
				if (typeof callback == 'function') 
									
					callback(isOkResponse == 0, response, numberMessages, totalSize);
			
			});
		
		}
		
		// Get the size of a specific message. Note that message numbers start at 1, not zero. If successful, callback 
		// has an message's size as an additional argument.
		
		this.getMessageSize = function (messageNumber, callback) {
		
			if (state != STATES.IDLE) 
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			if (typeof messageNumber == 'number')
			
				messageNumber = messageNumber.toString();
				
			else if (typeof messageNumber != 'string')
			
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
			
			state = STATES.WAITING_REPLY;
			pop3Client.sendLIST(messageNumber, function (isOkResponse, response, size) {
			
				state = STATES.IDLE;
				if (typeof callback == 'function')
									
					callback(isOkResponse == 0, response, size);
				
			});
		
		}
		
		// Get the size of all messages. Callback will have an additional argument array of size(s) ordered by message 
		// number.
		
		this.getAllMessageSizes = function (callback) {
		
			if (state != STATES.IDLE) 
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			state = STATES.WAITING_REPLY;
			pop3Client.sendLIST(function (isOkResponse, response, sizes) {
			
				state = STATES.IDLE;
				if (typeof callback == 'function')
				
					callback(isOkResponse == 0, response, sizes);
				
			});
		
		}
		
		// Retrieve an email. If successful, the email is in the server's reponse: Ignore first line which is POP3
		// protocol specific. Then content of email follows, a header (containing fields such as "From", "To", or
		// "Subject"), an empty line separator, followed by message's body. The email is terminated by a dot ('.')
		// on a single line. You can use Mail.parse() function to parse it.
		
		this.retrieveMessage = function (messageNumber, callback) {
		
			if (state != STATES.IDLE)
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			if (typeof messageNumber == 'number')
			
				messageNumber = messageNumber.toString();
				
			else if (typeof messageNumber != 'string')
			
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
			
			state = STATES.WAITING_REPLY;			
			pop3Client.sendRETR(messageNumber, function (isOkResponse, response) {

				state = STATES.IDLE;
				if (typeof callback == 'function')
			
					callback(isOkResponse == 0, response);
			
			});
		
		}
		
		// Mark a message for deletion. This message will not be deleted until a QUIT command has been issued (the POP3 
		// client must actually disconnect from server for it to do the actual update).
		
		this.markForDeletion = function (messageNumber, callback) {
		
			if (state != STATES.IDLE)

				throw new POP3Exception(POP3Exception.INVALID_STATE);
				
			if (typeof messageNumber == 'number')
			
				messageNumber = messageNumber.toString();
				
			else if (typeof messageNumber != 'string')
			
				throw new POP3Exception(POP3Exception.INVALID_ARGUMENT);
			
			state = STATES.WAITING_REPLY;			
			pop3Client.sendDELE(messageNumber, function (isOkResponse, response) {

				state = STATES.IDLE;
				if (typeof callback == 'function')
				
					callback(isOkResponse == 0, response);

			});

		}
		
		// This will clear all deletion mark(s) (you will need to mark them again).
		
		this.clearDeletionMarks = function (callback) {
		
			if (state != STATES.IDLE) 
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			state = STATES.WAITING_REPLY;			
			pop3Client.sendRSET(function (isOkResponse, response) {

				state = STATES.IDLE;
				if (typeof callback == 'function')

					callback(isOkResponse == 0, response);
			
			});
		
		}
		
		// Force closing and freeing of POP3 client. This will release all resources. Can be called several times.
		
		var forceClose = function () {

			state = STATES.TERMINATED;
			if (pop3Client != null) {
				
				pop3Client.forceClose();
				pop3Client = null;
			
			}

		}
		this.forceClose = forceClose;

		// Send QUIT command. The server will reply a response, then break the connection with client. It will then
		// delete marked messages, as requested.
		
		this.quit = function (callback) {

			if (state != STATES.IDLE)
			
				throw new POP3Exception(POP3Exception.INVALID_STATE);
			
			state = STATES.WAITING_REPLY;			
			pop3Client.sendQUIT(function (isOkResponse, response) {
		
				forceClose();
				if (typeof callback == 'function')

					callback(isOkResponse == 0, response);
			
			});

		}
		
		// Connect on creation.
		
		if (typeof address != 'undefined') 
			
			this.connect(address, port, isSSL, callback);
		
	}
	
	return POP3;

}

var POP3	= POP3Scope();

var getAll = function (address, port, isSSL, username, password, allMails, doMarkForDeletion) {
	
	var isWakanda	= typeof requireNative != 'undefined';
	var pop3		= new POP3();
	var	status		= false;
	
	if (typeof address != 'string' || typeof port != 'number' || typeof isSSL != 'boolean'
		|| typeof username != 'string' || typeof password != 'string' 
		|| !(allMails instanceof Array) || allMails.length)
		
		throw new pop3.POP3Exception(pop3.POP3Exception.INVALID_ARGUMENT);	

	// Function to exit event loop. Wakanda has the exitWait() function. Otherwise terminate POP3
	// client, this will close the socket and get out of event loop.
	
	var exit = function	() {
	
		if (isWakanda)
			
			exitWait();
		
		else 
			
			pop3.forceClose();	
		
	}
	
	// Function callbacks are named by states.
	
	var authentificationState, statusState, retrievalState, quittingState;
			
	authentificationState = function (isOk, response) { 
	
		if (!isOk) 
			
			exit();
			
		else
				
			pop3.authenticate(username, password, statusState);

	}
			
	statusState = function (isOk, response) {
	
		if (!isOk)
		
			exit();
	
		else
		
			pop3.getStatus(retrievalState);
	
	}
		
	retrievalState = function (isOk, response, numberMessages) {

		if (!isOk)
				
			exit();
			
		else if (!numberMessages)
		
			pop3.quit(quittingState);
			
		else {
			
			var	i = 1;
			
			// Callbacks for retrieval "asynchronous" loop.
			
			var markCallback, retrieveCallback;
			
			markCallback = function (isOk, response) {
							
				if (!isOk) 

					exit();
													
				else if (i == numberMessages) {
					
					// Last message has been marked for deletion.
					
					pop3.quit(quittingState);
					
				} else {
						
					// Message successfully marked, move on and retrieve remaining message(s).
						
					i++;
					pop3.retrieveMessage(i, retrieveCallback);

				}
							
			}
							
			retrieveCallback = function (isOk, response) {

				if (!isOk) 
					
					exit();
										
				else {
					
					allMails.push(response);
					if (doMarkForDeletion) 
						
						pop3.markForDeletion(i, markCallback);
										
					else if (i == numberMessages) {
						
						// We're done.
					
						pop3.quit(quittingState);
						
					} else {
						
						// Retrieve remaining message(s).
						
						i++;
						pop3.retrieveMessage(i, retrieveCallback);
						
					}
				
				}		

			}
			
			// Retrieve first message, this will start the retrieval "asynchronous" loop.
				
			pop3.retrieveMessage(i, retrieveCallback);
			
		}

	}
	
	quittingState = function (isOk, response) {
		
		status = isOk;
		exit();
	
	}
		
	// Connect to POP3 server. Code will go asynchronously from state to state via callbacks.

	pop3.connect(address, port, isSSL, authentificationState);	
	
	// If using Wakanda, function is made synchronous.
	
	if (isWakanda) {
			
		// Indefinite wait, callback events will exit wait when done.
	
		wait();
	
		// Force termination and release of POP3 client resource.
	
		pop3.forceClose();
		
	}
	
	return status;	
}

// Create a new POP3 object.

var createClient = function (address, port, isSSL, callback) {

	return new POP3(address, port, isSSL, callback);
	
}

// Connect to a POP3 server, retrieve all available messages, and delete them. All arguments are mandatory. allMails
// must be an empty Array, it will be filled with the retrieved message. Format of message is same as those returned
// by POP3.retrieveMessage() function. This function returns true if successful. If not, allMails contain message(s) 
// successfully read until error, and all messages are left on server (not deleted). This function is synchronous if
// Wakanda is used.

var getAllMailAndDelete = function (address, port, isSSL, username, password, allMails) {

	return getAll(address, port, isSSL, username, password, allMails, true);

}

// Same as getAllMailAndDelete(), except retrieved mails are left (not deleted) on POP3 server. 

var getAllMail = function (address, port, isSSL, username, password, allMails) {

	return getAll(address, port, isSSL, username, password, allMails, false);

}

exports.createClient = createClient;
exports.getAllMail = getAllMail;
exports.getAllMailAndDelete = getAllMailAndDelete;
exports.POP3 = POP3;
