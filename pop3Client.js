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

// Low level POP3 client.
//
// Reference:
//
//		http://www.ietf.org/rfc/rfc1939.txt
//
// Notes:
//
//	*	This is a low level library. There is no state. User is to send appropriate commands in the given state 
//		AUTHORIZATION, TRANSACTION, and UPDATE). You should be familiar with POP3's RFC before using.
//	
//	*	APOP command is currently unsupported.
// 
//	Usage:
//
//		POP3Client can connect at creation or by using connect() or sslConnect() functions. Unless specified, 
//		function arguments are optional. Remember that you must issue a QUIT command for the server to actually
//		delete marked message(s) after it has quit, otherwise nothing will happen! 
//
//		All argument(s) to functions, except callbacks, are mandatory unless specified. This is checked, an 
//		exception can be thrown.
//
//		First argument of callback is 0 if it is an ok response, 1 if it is an error response, or -1 if there 
// 		was a problem while reading the response. For an ok or error response, the second argument is the lines
//		making up the response. An error is always single line (usually containing some form of explaination 
//		from server). Ok response may be followed by additional arguments, see comments for individual comments 
//		for details.

function POP3ClientScope () {
	
	var FLAG_EXPECTING_DATA		= 0x1000;
	
	var STATES = {
		
		// "Normal" operation states.
		
		NOT_CONNECTED:			1,	// POP3Client just create, socket not yet connected.
		CONNECTING:				2,	// TCP connection.
		IDLE:					3,	// Connected and ready to send a command.
		TERMINATED:				4,	// QUIT has been sent and successfuly acknowledged.
		
		// Waiting response states.
		
		READING_GREETING:		FLAG_EXPECTING_DATA + 1,
				
		READING_RESPONSE_STAT:	FLAG_EXPECTING_DATA + 2,
		READING_RESPONSE_LIST:	FLAG_EXPECTING_DATA + 3,
		READING_RESPONSE_RETR:	FLAG_EXPECTING_DATA + 4,
		READING_RESPONSE_DELE:	FLAG_EXPECTING_DATA + 5,
		READING_RESPONSE_NOOP:	FLAG_EXPECTING_DATA + 6,
		READING_RESPONSE_RSET:	FLAG_EXPECTING_DATA + 7,	
		
		READING_RESPONSE_QUIT:	FLAG_EXPECTING_DATA + 8,
		
		READING_RESPONSE_TOP:	FLAG_EXPECTING_DATA + 9,
		READING_RESPONSE_UIDL:	FLAG_EXPECTING_DATA + 10,
		
		READING_RESPONSE_USER:	FLAG_EXPECTING_DATA + 11,
		READING_RESPONSE_PASS:	FLAG_EXPECTING_DATA + 12,
		READING_RESPONSE_APOP:	FLAG_EXPECTING_DATA + 13,		// TODO.
		
		READING_RESPONSE_RAW:	FLAG_EXPECTING_DATA + 14,			
		
		// Erroneous states.
		
		CONNECTION_BROKEN:		-1,	// Server has "half" or fully closed socket.
			
	};
	
	var	isWakanda	= typeof requireNative != 'undefined';
	
	var net			= isWakanda ? requireNative('net') : require('net');
	var tls			= isWakanda ? requireNative('tls') : require('tls');
	
	var okRegExp	= /^\+OK/;
	
	// POP3Client exception, just contains an error code.
	
	function POP3ClientException (code) {
	
		this.code;
	
	}
	POP3ClientException.INVALID_STATE		= -1;	// Command or operation can't be performed in current state.
	POP3ClientException.NOT_EXPECTING_DATA	= -2;	// Received data from server when not expecting some.
	POP3ClientException.INVALID_ARGUMENT	= -3;	// Function called with incorrect arguments.
		
	function POP3Client (address, port, isSSL, callback) {
		
		var state		= STATES.NOT_CONNECTED;
		var socket;
		
		var isMultiLineResponse;	// Expecting a single or multi-line response.
		var isOkResponse;			// -1: don't know yet, need more data, 0: ok response, 1: error response.
		var isLinePending;	
		
		var responseLines;				
		var responseCallback;		
		
		// Read response. Return zero if ongoing, positive if response properly read (ok or error), or negative
		// (see error codes) if a problem occured during reading.
		
		var readData = function (data) {
		
			var	lines = data.toString('binary').split('\r\n');	// Support 8-bit characters (8BITMIME).
		
			if (!isMultiLineResponse && lines.length > 2)
			
				return -1;
			
			var	i, j;
			
			if (isLinePending) {
			
				responseLines[responseLines.length - 1] = responseLines[responseLines.length - 1].concat(lines[0]);				
				if (lines.length == 1)
				
					return 0;
					
				else {
				
					isLinePending = false;
					i = 1;
					
				}
			
			} else
			
				i = 0;

			for (j = responseLines.length; i < lines.length - 1; i++, j++) {

				if (lines[i] == '..')	
				
					responseLines[j] = '.';
					
				else
				
					responseLines[j] = lines[i];
						
			}
			
			// If not determined yet, check if it's an ok or error response for server.
			
			if (isOkResponse < 0) {

				if (responseLines[0].match(okRegExp) != null)
				
					isOkResponse = 0;
					
				else { 
				
					// An error response is always single line.
				
					isOkResponse = 1;
					isMultiLineResponse = false;

				}
		
			}
			
			if (lines[i] != '') {
			
				responseLines[j] = lines[i];
				isLinePending = true;
				return 0;
			
			} else if (isMultiLineResponse) {

				// A dot ('.') on a single line indicates the end of a multi-line response.

				if (lines[i - 1] == '.')
				
					return 1;
					
				else
				
					return 0;			
			
			} else
			
				return 1;

		}
			
		// Feed data received from socket to this function.

		var readCallback = function (data) {

			if (!(state & FLAG_EXPECTING_DATA)) {
			
				// Erroneous condition, not expecting data.
				
				throw new POP3ClientException(POP3ClientException.NOT_EXPECTING_DATA);
			
			}

			var	r	= readData(data);

			if (!r) {
				
				// Ongoing response.
				
				return;
				
			} else if (r < 0) {
				
				// There was a problem while reading response. Advise the callback (if any), then fall back to idle
				// state.
								
				state = STATES.IDLE;
				if (typeof responseCallback == 'function')
					
					responseCallback(-1);
				
			} else {	// r > 0 (complete reply)
				
				switch (state) {

					case STATES.READING_GREETING: {
				
						state = STATES.IDLE;																				
						if (typeof responseCallback == 'function')
									
							responseCallback(isOkResponse, responseLines);
						
						break;
							
					}
					
					case STATES.READING_RESPONSE_STAT: {
					
						state = STATES.IDLE;																				
						if (typeof responseCallback == 'function') {

							var numberMessages, totalSize;
													
							if (!isOkResponse) {
							
								var	array = responseLines[0].split(' ');
							
								if (array != null) {
								
									numberMessages = array[1];
									totalSize = array[2];		
								
								}
								
							} 
							responseCallback(isOkResponse, responseLines, numberMessages, totalSize);
							
						}
						break;
					
					}
					
					case STATES.READING_RESPONSE_LIST: {
					
						state = STATES.IDLE;																				
						if (typeof responseCallback == 'function') {
						
							var sizes;
							
							if (!isOkResponse) {
							
								// sizes is the size of the queried message or an array of the sizes of all messages.
															
								if (isMultiLineResponse) {
								
									var i, j;
									
									sizes = new Array();
									for (i = 1, j = 0; i < responseLines.length - 1; i++, j++) {
									
										var	array;
										
										array = responseLines[i].split(' ');
										sizes[j] = array != null ? array[1] : null;
										
									}
								
								} else 
								
									sizes = responseLines[0].split(' ')[2];
														
							}
							responseCallback(isOkResponse, responseLines, sizes);					
					
						}						
						break;						
					
					}
					
					case STATES.READING_RESPONSE_RETR: 
					case STATES.READING_RESPONSE_DELE:
					case STATES.READING_RESPONSE_NOOP:	
					case STATES.READING_RESPONSE_RSET:
					case STATES.READING_RESPONSE_QUIT: 
					case STATES.READING_RESPONSE_TOP: 
					case STATES.READING_RESPONSE_USER: 
					case STATES.READING_RESPONSE_PASS: 
					case STATES.READING_RESPONSE_RAW: {		
					
						state = STATES.IDLE;																				
						if (typeof responseCallback == 'function') 
						
							responseCallback(isOkResponse, responseLines);
							
						break;
						
					}
					
					case STATES.READING_RESPONSE_UIDL: {
					
						state = STATES.IDLE;																				
						if (typeof responseCallback == 'function') {
						
							var uids;
							
							if (!isOkResponse) {
							
								// uids is the uid of the queried message or an array of all the uids.
															
								if (isMultiLineResponse) {
								
									var i, j;
									
									uids = new Array();
									for (i = 1, j = 0; i < responseLines.length - 1; i++, j++) {
									
										var	array;
										
										array = responseLines[i].split(' ');
										uids[j] = array != null ? array[1] : null;
										
									}
								
								} else 
								
									uids = responseLines[0].split(' ')[2];
														
							}
							responseCallback(isOkResponse, responseLines, uids);
					
						}						
						break;						
					
					}
					
					default: {
					
						// Impossible.
						
						throw new POP3ClientException(POP3ClientException.INVALID_STATE);
						
					}
								
				}
			
			} 	
				
		}

		var closeCallback = function (hasError) {

			if (socket != null) {
			
				socket.destroy();
				socket = null;
				
			}
			if (state != STATES.TERMINATED)
			
				state = STATES.CONNECTION_BROKEN;
		
		}

		var connect = function (isSSL, address, port, callback) {
			
			if (state != STATES.NOT_CONNECTED)
			
				throw new POP3ClientException(POP3ClientException.INVALID_STATE);
				
			else {
				
				var	connectCallback = function () {
				
					// Socket has been successfully created.
															
					socket.addListener('data', readCallback);
					state = STATES.READING_GREETING;
					
					// Treat "half-close" as "full-close".

					socket.addListener('end', closeCallback);
					socket.addListener('close', closeCallback);
					
					// Await greeting from POP3 server.
					
					isMultiLineResponse = isLinePending = false;
					isOkResponse = -1;
					isLinePending = false;	
					responseLines = new Array();
					responseCallback = callback;			
																  
				};
				
				state = STATES.CONNECTING;
				
				if (isSSL) 
										
					socket = tls.connect(port, address, connectCallback);
					
				else {
				
					// No callback for net.createConnection() for nodejs v0.4.
					
					socket = net.createConnection(port, address);
					socket.addListener('connect', connectCallback);
										
				}
				
			}
			
		}		

		var sendCommand = function (command, isMultiLine, newState, callback) {
			
				if (state != STATES.IDLE)
				
					throw new POP3ClientException(POP3ClientException.INVALID_STATE);
				
				else {
			
					isMultiLineResponse = isMultiLine;
					isOkResponse = -1;
					isLinePending = false;
					responseLines = new Array();
					responseCallback = callback;						
					
					state = newState;
					socket.write(command);

				}
				
		}

		// Connect to a POP3 server.

		this.connect = function (address, port, callback) {
		
			connect(false, address, port, callback);
				
		}
		
		// Connect to a POP3 server using SSL.
								
		this.sslConnect = function (address, port, callback) {
			
			connect(true, address, port, callback);

		}		
		
		// Force termination of this session: Destroy the socket if any. Mark connection as broken.
		//
		// You should rather send a QUIT command then wait for an +OK response from server. After sending reply, 
		// the server will automatically close the connection.
		
		this.forceClose = function () {

			state = STATES.CONNECTION_BROKEN;		
			if (socket != null) {
			
				socket.destroy();
				socket = null;
			
			}
		
		}
		
		// Send STAT command. Callback will have two additional arguments: numberMessages (message(s) available on
		// server) and totalSize (total size of available message(s)).
		
		this.sendSTAT = function (callback) {
		
			sendCommand('STAT\n', false, STATES.READING_RESPONSE_STAT, callback);

		}
		
		// Send LIST command. As an additional argument to callback, this will return size of queried message. If 
		// messageNumber is not specified, this will return all sizes in an array. messageNumber must be a string
		// otherwise.
		
		this.sendLIST = function (messageNumber, callback) {
		
			if (!arguments.length || typeof arguments[0] == 'function')
			
				sendCommand('LIST\n', true, STATES.READING_RESPONSE_LIST, arguments[0]);
			
			else if (typeof messageNumber != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);

			else

				sendCommand('LIST ' + messageNumber + '\n', false, STATES.READING_RESPONSE_LIST, callback);	

		}

		// Retrieve a message, messageNumber should be a valid non deleted email. Message content is returned as the
		// second argument to callback (an array of lines). You don't have to worry about "byte-stuffing" (single dot on a
		// line). Use Mail library to parse content. messageNumber is a string!
		
		this.sendRETR = function (messageNumber, callback) {
			
			if (typeof messageNumber != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
				
			else
		
				sendCommand('RETR ' + messageNumber + '\n', true, STATES.READING_RESPONSE_RETR, callback);
		
		}

		// Mark a message for deletion. Server will do the actual deletion when in update state, that is after a QUIT 
		// command has been issued. The message number must have been converted to a string.

		this.sendDELE = function (messageNumber, callback) {
		
			if (typeof messageNumber != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
				
			else
		
				sendCommand('DELE ' + messageNumber + '\n', false, STATES.READING_RESPONSE_DELE, callback);
		
		}

		// Send a NOOP command, this does nothing.

		this.sendNOOP = function (callback) {
		
			sendCommand('NOOP\n', false, STATES.READING_RESPONSE_NOOP, callback);
		
		}
		
		// Send a RSET command, this will unmark all messages marked for deletion.

		this.sendRSET = function (callback) {
		
			sendCommand('RSET\n', false, STATES.READING_RESPONSE_RSET, callback);
		
		}

		// Send a QUIT command. After sending response, server will close connection.

		this.sendQUIT = function (callback) {
		
			sendCommand('QUIT\n', false, STATES.READING_RESPONSE_QUIT, callback);
		
		}

		// Send a TOP command. All arguments except callback are mandatory. The callback has same argument as sendRETR()
		// but with a maximum of numberLines lines. Message number and number of lines must be given as strings.

		this.sendTOP = function (messageNumber, numberLines, callback) {
		
			if (typeof messageNumber != 'string' || typeof numberLines != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
				
			else {
		
				var command	= 'TOP ' + messageNumber + ' ' + numberLines + '\n';
		
				sendCommand(command, true, STATES.READING_RESPONSE_TOP, callback);
				
			}
		
		}
		
		// Send UIDL command. Second argument to callback will be the uid of the queried message (messageNumber). If 
		// no message number is specified, all uids for all messages will be returned in an array.
		
		this.sendUIDL = function (messageNumber, callback) {
		
			if (!arguments.length || typeof arguments[0] == 'function')
			
				sendCommand('UIDL\n', true, STATES.READING_RESPONSE_UILD, arguments[0]);
			
			else if (typeof messageNumber != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);

			else
				sendCommand('UIDL ' + messageNumber + '\n', false, STATES.READING_RESPONSE_UIDL, callback);
			
		}
			
		// Send a USER command. After completion, a PASS command should follow.

		this.sendUSER = function (username, callback) {
		
			if (typeof username != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
				
			else
		
				sendCommand('USER ' + username + '\n', false, STATES.READING_RESPONSE_USER, callback);
		
		}

		// Send a PASS command, pasw. If successful, server will go to TRANSACTION state.

		this.sendPASS = function (password, callback) {
		
			if (typeof password != 'string')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
				
			else
		
				sendCommand('PASS ' + password + '\n', false, STATES.READING_RESPONSE_PASS, callback);
		
		}

		// Send a "raw" command, which can be anything. The terminating '\n' will be added automatically. It is 
		// mandatory to specify if the response is to be multi-line or single. Callback will receive an array of 
		// lines, which is the response.

		this.sendRawCommand = function (command, isMultiLine, callback) {
		
			if (typeof command != 'string' || typeof isMultiLine != 'boolean')
			
				throw new POP3ClientException(POP3ClientException.INVALID_ARGUMENT);
		
			else
			
				sendCommand(command + '\n', isMultiLine, STATES.READING_RESPONSE_RAW, callback);

		}
		
		// Connect at creation if arguments given to constructor.
		
		if (typeof address == 'string' && typeof port == 'number')  {
		
			if (arguments.length == 2)
			
				connect(false, address, port);
				
			else if (arguments.length == 3) {
			
				if (typeof arguments[2] == 'function') 
				
					connect(false, address, port, arguments[2]);
					
				else 
				
					connect(isSSL, address, port);
					
			} else
			
				connect(isSSL, address, port, callback);
		
		}
		
	}
		
	return POP3Client;	
		
}
exports.POP3Client = POP3ClientScope();
