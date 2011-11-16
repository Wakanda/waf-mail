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

// Low level SMTP client with support for ESMTP extensions.
//
// References:
//
//		http://www.ietf.org/rfc/rfc5321.txt (SMTP)
//		http://www.ietf.org/rfc/rfc6152.txt (8BITMIME)
//
// Notes:
//
//	*	This is a low level library. For instance, it has no state to remember whether a MAIL command has been issued
//		to initiate a new mail, before a RCPT or DATA command is sent. User has to ensure correct formating of mail 
//		content (use Mail library). For instance, there is no checking for lines over 1000 bytes. Because it is a low
//		level library, caller will have to handle directly some SMTP extensions (such as STARTTLS), using the
//		sendRawCommand() function.
//
//	*	Calling a forbidden commands for the current state or with invalid arguments(s) will throw an exception. All
//		arguments are mandatory, except for callback (last argument) which is optional.	Callbacks always have a 
//		ThreeDigitReply object as first argument, followed by additional arguments. User must always first check if 
//		the reply is ok (no error while reading) before retrieving its content.
//
// Usage:
//
// 		Low level SMTP client, best used if familiar with SMTP protocol. Object can do TCP/IP connection at creation
//		(if given proper arguments when constructor is called). Or manually connect using connect() or sslConnect().
//		When connected, it is up to caller to issue proper commands and follow protocol.

function SMTPClientScope () {
	
	var FLAG_READING_REPLY		= 0x1000;

	var STATES = {
		
		// "Normal" operation states.
		
		NOT_CONNECTED:			1,	// SMTPClient object has just been created.
		CONNECTING:				2,	// TCP connection.
		IDLE:					3,	// Connected and ready to send a command.
		TERMINATED:				4,	// QUIT has been sent and successfuly acknowledged.
		
		// Waiting reply states.
		
		READING_GREETING:		FLAG_READING_REPLY | 0,
		READING_REPLY_HELO:		FLAG_READING_REPLY | 1,
		READING_REPLY_EHLO:		FLAG_READING_REPLY | 2,
		
		READING_REPLY_NOOP:		FLAG_READING_REPLY | 3,	
		READING_REPLY_RSET:		FLAG_READING_REPLY | 4,
		READING_REPLY_QUIT:		FLAG_READING_REPLY | 5,		
		
		READING_REPLY_MAIL:		FLAG_READING_REPLY | 6,
		READING_REPLY_RCPT:		FLAG_READING_REPLY | 7,
		READING_REPLY_DATA:		FLAG_READING_REPLY | 8,
		READING_REPLY_CONTENT:	FLAG_READING_REPLY | 9,
		
		READING_REPLY_VRFY:		FLAG_READING_REPLY | 10,
		READING_REPLY_EXPN:		FLAG_READING_REPLY | 11,
		READING_REPLY_HELP:		FLAG_READING_REPLY | 12,
		READING_REPLY_RAW:		FLAG_READING_REPLY | 13,
		
		// Erroneous states.
		
		CONNECTION_BROKEN:		-1,	// Server has "half" or fully closed socket.
			
	};
	
	var	isWakanda		= typeof requireNative != 'undefined';
	
	var net				= isWakanda ? requireNative('net') : require('net');
	var tls				= isWakanda ? requireNative('tls') : require('tls');
	
	var threeDigitReply = isWakanda ? require('waf-mail/threeDigitReply') : require('./threeDigitReply.js');
	
	// SMTPClient exception, just contains an error code (see below).
	
	function SMTPClientException (code) {
		
		this.code = code;

	}
	
	// SMTPClient exception error codes.
	
	SMTPClientException.INVALID_STATE		= -1;	// Command or operation cannot be performed in current state.
	SMTPClientException.NOT_EXPECTING_DATA	= -2;	// Received not expected data from server.
	SMTPClientException.INVALID_ARGUMENT	= -3;	// Function has been called with incorrect arguments.
	
	function SMTPClient (address, port, isSSL, callback) {
			
		var state		= STATES.NOT_CONNECTED;
		var socket;									
		var extensions	= undefined;			// An array of the lines returned by EHLO command. Codes ("250") at 
												// start of lines are removed.
		
		// Current command's reply.
		
		var reply;			
		var replyCallback;
		
		// Feed data received from socket to this function.
			
		var readCallback = function (data) {

			if (state & FLAG_READING_REPLY) {
			
				var	r	= reply.readData(data.toString('binary'));	// Support 8-bit characters
												// (8BITMIME).

				if (!r) {
				
					// Ongoing reply.
				
					return;
				
				} else if (r < 0) {
				
					// The reply is invalid, advise the callback if any, then fall back to idle state.
					// reply.isOk() will return false. Use reply.getErrorCode() to pinpoint error.

					state = STATES.IDLE;
					if (typeof replyCallback == 'function')
					
						replyCallback(reply);	
				
				} else {	// r > 0 (Complete reply, r is the number of lines.)
				
					switch (state) {
					
					case STATES.READING_GREETING:
				
						state = STATES.IDLE;																						
						if (typeof replyCallback == 'function') {
									
							var	isProbableESMTP;
						
							isProbableESMTP = reply.getLines()[0].match(/ESMTP/) != null;							
							replyCallback(reply, isProbableESMTP);
							
						}
								
						break;

					case STATES.READING_REPLY_HELO:					
					case STATES.READING_REPLY_EHLO: {	
				
						var	domain;
				
						if (reply.isPositiveCompletion()) {
						
							var firstLine;
							
							firstLine = reply.getLines()[0].substring(4);
						
							domain = firstLine.match(/\ /);
							if (domain != null)
							
								domain = firstLine.substring(0, domain.index);
								
							else
							
								domain = undefined;						
						
							if (state == STATES.READING_REPLY_EHLO) {
							
								// Should check that code is "250" as per specification.
							
								var	i, lines;

								extensions = new Array();
								for (i = 1, lines = reply.getLines(); i < lines.length; i++) 
								
									extensions.push(lines[i].substring(4));
														
							}
						
						}

						state = STATES.IDLE;		
						if (typeof replyCallback == 'function') 									
						
							replyCallback(reply, domain, extensions);
							
						break;
					
					}
					
					case STATES.READING_REPLY_RSET:	
					case STATES.READING_REPLY_NOOP:	
					
					case STATES.READING_REPLY_MAIL:	
					case STATES.READING_REPLY_RCPT:	
					case STATES.READING_REPLY_DATA:	
					case STATES.READING_REPLY_CONTENT:
					
					case STATES.READING_REPLY_VRFY:	
					case STATES.READING_REPLY_EXPN:	 
					case STATES.READING_REPLY_HELP:
					
					case STATES.READING_REPLY_RAW:
					
						state = STATES.IDLE; 				
						if (typeof replyCallback == 'function') 
									
							replyCallback(reply);
	
						break;
					
					case STATES.READING_REPLY_QUIT:

						// Doesn't check reply for success or failure, always consider session as terminated.
					
						state = STATES.TERMINATED;
						if (typeof replyCallback == 'function')
				
							replyCallback(reply);
								
						break;
					
					default: 

						// Impossible.

						throw new SMTPClientException(SMTPClientException.INVALID_STATE);

					}
								
				}
			
			} else {
			
				// Not expecting reply from server.
						
				throw new SMTPClientException(SMTPClientException.NOT_EXPECTING_DATA);
			
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
			
				throw new SMTPClientException(SMTPClientException.INVALID_STATE);
						
			else {
				
				reply = new threeDigitReply.ThreeDigitReply();
				replyCallback = callback;
				state = STATES.CONNECTING;	
				
				var connectCallback = function () {
					
					// Socket has been successfully created.
					
					socket.addListener('data', readCallback);
					state = STATES.READING_GREETING;
					
					// Treat "half-close" as "full-close".
					
					socket.addListener('end', closeCallback);
					socket.addListener('close', closeCallback);
										
				}
				
				if (isSSL)
					
					socket = tls.connect(port, address, connectCallback);
				
				else {
					
					// Callback is not supported net.createConnection() of nodejs v0.4.
					
					socket = net.createConnection(port, address);
					socket.addListener('connect', connectCallback);
									
				}
				
			}
			
		}		
				
		var sendCommand = function (command, newState, callback) {
		
			if (state != STATES.IDLE) 
				
				throw new SMTPClientException(SMTPClientException.INVALID_STATE);
			
			else {
			
				reply = new threeDigitReply.ThreeDigitReply();
				replyCallback = callback;
				state = newState;
				socket.write(command);
				
			}
		
		}
		
		var sendHelloCommand = function (command, newState, domain, callback) {
			
			var command;
							
			if (typeof domain != 'undefined') {
				
				if (typeof domain != 'string') 
					
					throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);					
										
				else

					command += ' ' + domain + '\r\n';				
				
			} else 
			
				command += '\r\n';
				
			sendCommand(command, newState, callback);
						
		}
		
		// Connect to a SMTP server.

		this.connect = function (address, port, callback) {
		
			connect(false, address, port, callback);
				
		}
		
		// Connect to a SMTP server using SSL.
								
		this.sslConnect = function (address, port, callback) {
			
			connect(true, address, port, callback);

		}		
		
		// Force termination of this session: Destroy the socket if any.
		// Mark connection as broken.
		// You should send a QUIT command then wait for server positive completion reply.
		// After sending reply, the server will automatically close the connection.
		
		this.forceClose = function () {

			state = STATES.CONNECTION_BROKEN;		
			if (socket != null) {
			
				socket.destroy();
				socket = null;
			
			}
		
		}
		
		// Send a HELO command, should use EHLO instead if possible.
		
		this.sendHELO = function (domain, callback) {
		
			if (!arguments.length || typeof arguments[0] == 'function') {
				
				callback = arguments[0];	// If no arguments, this will be undefined, which is ok.
				domain = '';
				
			}			
			sendHelloCommand('HELO', STATES.READING_REPLY_HELO, domain, callback);
			
		}
		
		// Send a EHLO command.
		
		this.sendEHLO = function (domain, callback) {

			if (!arguments.length || typeof arguments[0] == 'function') {
				
				callback = arguments[0];	// If no arguments, this will be undefined, which is ok.
				domain = '';
				
			}			
			sendHelloCommand('EHLO', STATES.READING_REPLY_EHLO, domain, callback);
			
		}

		// Send a NOOP, string argument is usually ignored, see section 4.1.1.9 of RFC5321.
		
		this.sendNOOP = function (string, callback) {
			
			if (!arguments.length || typeof arguments[0] == 'function')
				
				sendCommand('NOOP\r\n', STATES.READING_REPLY_NOOP, arguments[0]);
			
			else if (typeof string == 'string')
			
				sendCommand('NOOP ' + string + '\r\n', STATES.READING_REPLY_NOOP, callback);
			
			else
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);	
			
		}
		
		// Send a RSET command, this will reset the ongoing mail sending state, see section 4.1.1.5 of RFC5321.
		
		this.sendRSET = function (callback) {
		
			sendCommand('RSET\r\n', STATES.READING_REPLY_RSET, callback);
		
		}
		
		// Send QUIT command, this will terminate this session. SMTP will answer and then close connection. 
		
		this.sendQUIT = function (callback) {
		
			sendCommand('QUIT\r\n', STATES.READING_REPLY_QUIT, callback);
		
		}

		// Send a MAIL command, this will initiate a mail sending, see section 4.1.1.2 of RFC5321.
		// No check that server actually support 8BITMIME extension.
		
		this.sendMAIL = function (from, is8bitMIME, callback) {
		
			if (typeof from != 'string')
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);	
			
			else if (typeof arguments[1] != 'function') {
				
				if (is8bitMIME == true) 
				
					sendCommand('MAIL FROM:' + from + ' BODY=8BITMIME\r\n', STATES.READING_REPLY_MAIL, callback);
				
				else

					sendCommand('MAIL FROM:' + from + '\r\n', STATES.READING_REPLY_MAIL, callback);
		
			} else 
			
				sendCommand('MAIL FROM:' + from + '\r\n', STATES.READING_REPLY_MAIL, arguments[1]);
		
		}

		// Send a RCPT command, see section 4.1.1.3 of RFC5321. Should be sent only after a successful MAIL command.
		// It is possible to specify several recipients for an email.
		
		this.sendRCPT = function (to, callback) {
		
			if (typeof to != 'string')
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);
			
			else
				
				sendCommand('RCPT TO:' + to + '\r\n', STATES.READING_REPLY_RCPT, callback);
	
		}
		
		// Send DATA command, see section 4.1.1.4 of RFC5321. This command is to be sent after both MAIL and RCPT 
		// commands have been successfully sent. A successful DATA command will reply a positive intermediate (code 
		// 354), email content can then be sent.
		
		this.sendDATA = function (callback) {
		
			sendCommand('DATA\r\n', STATES.READING_REPLY_DATA, callback);
			
		}
        
        // Send the content of email, must be called just after a successful DATA with positive intermediate code. As 
		// this library is low level, there is no check for that. There is also no check for "\r\n.\r\n" characters 
		// sequence, which mark the end of mail content submission.
                
        this.sendContent = function (content) {
        
            socket.write(content);
        
        }
               
        // Use this method to send the mail content terminator and set-up callback for reply.
        // Note that the line before terminator must end with a '\r\n' sequence.
		
        this.sendContentTerminator = function (callback) {
		
			sendCommand('.\r\n', STATES.READING_REPLY_CONTENT, callback);
			
		}
		
		// Send a VRFY, see section 4.1.1.6 of RFC5321. Most SMTP servers will answer with a positive completion reply, 
		// yet without actually confirming that user has been identified. This is to foil spammers.
		
		this.sendVRFY = function (user, callback) {		

			if (typeof user != 'string')
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);
			
			else
				
				sendCommand('VRFY ' + user + '\r\n', STATES.READING_REPLY_VRFY, callback);
		
		}
		
		// Send a EXPN, see section 4.1.1.7 of RFC5321. Not supported by many SMTP servers.
		
		this.sendEXPN = function (mailingList, callback) {		
		
			if (typeof mailingList != 'string')
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);
				
			else
				
				sendCommand('EXPN ' + mailingList + '\r\n', STATES.READING_REPLY_EXPN, callback);
		
		}		
		
		// Send a HELP, string argument may be supported, see section 4.1.1.8 of RFC5321.
	
		this.sendHELP = function (string, callback) {		

			if (!arguments.length)
				
				sendCommand('HELP\r\n', STATES.READING_REPLY_HELP);
			
			else if (typeof string == 'string')

				sendCommand('HELP ' + string + '\r\n', STATES.READING_REPLY_HELP, callback);
			
			else if (typeof arguments[0] == 'function')
				
				sendCommand('HELP\r\n', STATES.READING_REPLY_HELP, arguments[0]);
				
			else
				
				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);
					
		}
		
		// Send a "raw" command, can be anything. The '\r\n' terminating the command line will be added automatically.
		
		this.sendRawCommand = function (command, callback) {
		
			if (typeof command != 'string')

				throw new SMTPClientException(SMTPClientException.INVALID_ARGUMENT);
				
			else 

				sendCommand(command + '\r\n', STATES.READING_REPLY_RAW, callback);

		}
		
		// Return true if server is ESMTP and EHLO command has been issued successfully.
				
		this.isESMTP = function () {
		
			if (state == STATES.NOT_CONNECTED) 
			
				throw new SMTPClientException(SMTPClientException.INVALID_STATE);
					
			else
			
				return extensions != null;
		
		}
		
		// Return extensions (reply from EHLO): An array of strings, lines after first line line of reply from EHLO.
					
		this.getExtensions = function () {

			if (state == STATES.NOT_CONNECTED) 
			
				throw new SMTPClientException(SMTPClientException.INVALID_STATE);
					
			else
		
				return extensions;
		
		}
		
		// Low-level function to retrieve SMTP client's socket.

        this.getSocket = function () {
        
			if (state == STATES.NOT_CONNECTED) 
			
				throw new SMTPClientException(SMTPClientException.INVALID_STATE);

			else
		
				return socket;
            
        }
		
		// Connect at creation if arguments given to constructor.
	
		if (typeof address == 'string' && typeof port == 'number') {
		
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
	
	return SMTPClient;	

}
exports.SMTPClient = SMTPClientScope();
