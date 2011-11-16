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

// SMTP library. 
//
// Usage:
//
//		There are two ways to use this library. You can either create an SMTP object and connect it to a SMTP
//		server. This is the more versatile way. As it will allow you to send several emails, and disconnecting 
//		when done. Or you can use the send() function, which will do everything necessary to connect and submit
//		a message to a SMTP server. All callbacks have same first two arguments: a boolean telling if operation
//		was successful followed by an array of line(s) containing the actual reply by the SMTP server. Additional
//		arguments may follow.
//		
//		If you need more control (and are familiar with SMTP protocol), use the SMTPClient low-level library.

function SMTPScope () {

	var DEFAULT_PORT			= 25;

	var STATES = {
		
		NOT_CONNECTED:			1,	// State just after creation.
		IDLE:					2,	// Connected to SMTP server, awaiting commands.
		STARTTLS:               3,  // Upgrading to SSL.
		AUTHENTIFICATION:		4,	// Authentification.
		SENDING_MAIL:			5,	// Sending an email.
		TERMINATED:				6,	// Has sent QUIT command.

		CONNECTION_BROKEN:		-1,	// Connection has been lost.
			
	};

	var	isWakanda	= typeof requireNative == 'undefined';
	
	var mail;
	var smtp;			
	var threeDigitReply;

	if (isWakanda) {

		smtp = require('./smtpClient.js');
		threeDigitReply = require('./threeDigitReply.js');
		mail = require('./mail.js');

	} else {

		smtp = require('waf-mail/smtpClient');
		threeDigitReply = require('waf-mail/threeDigitReply');
		mail = require('waf-mail/mail');

	}
	
	// Exception for SMTP, see codes below.
	
	var SMTPException  = function (code) {
	
		this.code = code;
	
	}
	SMTPException.INVALID_STATE		= -1;	// Command or operation can't be performed in current state.
	SMTPException.INVALID_ARGUMENT	= -2;	// At least an argument is wrong.
	
	// If arguments are given, connect to server on creation.	

	function SMTP (address, port, isSSL, domain, callback) {
				
		var state			= STATES.NOT_CONNECTED;
		var smtpClient		= new smtp.SMTPClient();
		var nonSSLDomain;
		
		this.SMTPException = SMTPException;
		
		// Connect to a SMTP server. All arguments except callback are mandatory. Note that some SMTP servers require 
		// domain to be specified, you may use an empty string if not needed. Callback has an additional third boolean
		// argument, indicating if the connected server is ESMTP. connect() function will always try to use the EHLO 
		// command before HELO.
		
		this.connect = function (address, port, isSSL, domain, callback) {
		
			if (state != STATES.NOT_CONNECTED) 
		
				throw new SMTPException(SMTPException.INVALID_STATE);
						
			if (typeof address != 'string' || typeof port == 'undefined' || typeof isSSL == 'undefined' 
			|| typeof domain != 'string')
				
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
		
			if (typeof port == 'string') 
				
				port = port.toNumber();
					
			else if (typeof port != 'number') {
				
				// Port must be a number.
		
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
				
			}			
			
			nonSSLDomain = domain;	// Save for later use.
				
			var	connectFunction = isSSL ? smtpClient.sslConnect : smtpClient.connect;
			
			connectFunction(address, port, function (reply, isProbableESMTP) {
			
				// If possible, use ESMTP.

				if (reply.isPositiveCompletion()) {
				
					var helloCommand;
								
					helloCommand = isProbableESMTP ? smtpClient.sendEHLO : smtpClient.sendHELO;
					helloCommand(domain, function (reply) {
					
						if (reply.isPositiveCompletion()) {
				
							state = STATES.IDLE;
							if (typeof callback == 'function')
					
								callback(true, reply.getLines(), helloCommand == smtpClient.sendEHLO);
					
						} else {
						
							// Try HELO command, not ESMTP.
							
							smtpClient.sendHELO(domain, function (reply) {

								state = STATES.IDLE;
								if (typeof callback == 'function')
					
									callback(reply.isPositiveCompletion(), reply.getLines(), false);
					
							});
						
						}

					});
					
				} else {
				
					// Error at greeting should not happen.
				
					if (typeof callback == 'function') 
					
						callback(false, reply.getLines());
					
				}

			});
			
		}
		
		var authenticateUser, authenticatePassword, authenticateCallback;
		
		var authenticateCompleteCallback = function (reply) {

			state = STATES.IDLE;
			if (typeof authenticateCallback == 'function')
				
				authenticateCallback(reply.isPositiveCompletion(), reply.getLines());				

		}

		var authenticatePasswordCallback = function (reply) {
		
			if (!reply.isPositiveIntermediate()) {
			
				state = STATES.IDLE;
				if (typeof authenticateCallback == 'function')
				
					authenticateCallback(false, reply.getLines());				
			
			} else
			
				smtpClient.sendRawCommand(authenticatePassword, authenticateCompleteCallback);
		
		}
		
		var authenticateUserCallback = function (reply) {
		
			if (!reply.isPositiveIntermediate()) {
			
				state = STATES.IDLE;
				if (typeof authenticateCallback == 'function')
				
					authenticateCallback(false, reply.getLines());				
			
			} else
			
				smtpClient.sendRawCommand(authenticateUser, authenticatePasswordCallback);
			
		}
				
		// Authenticate with SMTP. Currently only support "AUTH LOGIN" (username and password are sent using base64).
		
		this.authenticate = function (user, password, callback) {
	
			if (state != STATES.IDLE) 
		
				throw new SMTPException(SMTPException.INVALID_STATE);
		
			else if (typeof user != 'string' || typeof password != 'string') {
			
				// Invalid parameter.
				
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
			
			} else {
			
				// TODO: Add check "AUTH LOGIN" support first.

				authenticateUser = (new Buffer(user)).toString('base64');
				authenticatePassword = (new Buffer(password)).toString('base64');
				authenticateCallback = callback;
				
				state = STATES.AUTHENTIFICATION;
				smtpClient.sendRawCommand('AUTH LOGIN', authenticateUserCallback);
			
			}
		
		}
		
		// Issue the STARTTLS command, this will "upgrade" connection to secured.
		
		this.starttls = function (callback) {
		
			if (state != STATES.IDLE) 
		
				throw new SMTPException(SMTPException.INVALID_STATE);
				
			else {
			
			    state = STATES.STARTTLS;
				smtpClient.sendRawCommand('STARTTLS', function (reply) {
				
				    state = STATES.IDLE;
				    if (!reply.isPositiveCompletion()) {
				    
				        if (typeof callback == 'function')
				        
    				        callback(false, reply.getLines())
				        				    
				    } else {
					
						// Upgrade to SSL. Specification requests that EHLO command is resent.
						// Do so with domain used by initial EHLO (from server's greeting).
						// Wait a few milliseconds before doing so.
				    
				        smtpClient.getSocket().setSecure();
				        setTimeout(function () {
						
							smtpClient.sendEHLO(nonSSLDomain, function (reply) {    
				        
				                if (typeof callback == 'function')
				        
    				                callback(reply.isPositiveCompletion(), reply.getLines())
				        		
				            });
				            
				        }, 100);
				        
                    }
				    
				});
				
			}
		
		}		
		
		var sendRecipients, sendRecipientsIndex, sendMail, sendCallback;
		
		var sendContentTerminatorCallback = function (reply) {
		
			state = STATES.IDLE;
			if (typeof sendCallback == 'function') 
				
				sendCallback(reply.isPositiveCompletion(), reply.getLines());		
		
		}
		
		var sendContentCallback = function (reply) {
	
			if (!reply.isPositiveIntermediate()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
		
			} else {
			
				var	i;
				
				// Send header.
				
				var header	= sendMail.getHeader();
						
				for (i = 0; i < header.length; i++) {
				
					smtpClient.sendContent(header[i]);
					smtpClient.sendContent('\r\n');
					
				}
								
				// An empty line separates header and body.
				
				smtpClient.sendContent('\r\n');				
				
				// Send body if any.
				
				var body	= sendMail.getBody();
				
				for (i = 0; i < body.length; i++) {
				
					smtpClient.sendContent(body[i]);
					smtpClient.sendContent('\r\n');
				
				}
					
				// A single dot on a line terminates an email.				

				smtpClient.sendContentTerminator(sendContentTerminatorCallback);
			
			}		
		
		}
		
		var sendDataCallback = function (reply) {
		
			if (!reply.isPositiveCompletion()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
				
			} else

				smtpClient.sendDATA(sendContentCallback);
		
		}
		
		var sendRecipientCallback = function (reply) {
		
			if (!reply.isPositiveCompletion()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
		
			} else {
			
				var recipient, callback;
		
				recipient = sendRecipients[sendRecipientsIndex];
				callback = sendRecipientsIndex == sendRecipients.length - 1 ? sendDataCallback : sendRecipientCallback;
				sendRecipientsIndex++;
			
				smtpClient.sendRCPT('<' + recipient + '>', callback);
			
			}

		}

		// Send an email. 
		//
		//	from:			the sender of email;
		//	recipients:		the recipient or an array of recipients (String);
		//	email:			a Mail object which is the mail to send, all its fields must have been set;
		//	callback:		called upon success or failure: first argument is true if successful, second
		//					argument is the lines of the last reply.
		
		this.send = function (from, recipients, email, callback) {

			if (state != STATES.IDLE)

				throw new SMTPException(SMTPException.INVALID_STATE);
				
			if (typeof from != 'string' 
			|| (typeof recipients != 'string' && !(recipients instanceof Array))
			|| !(email instanceof mail.Mail)
			|| (typeof callback != 'function' && typeof callback != 'undefined'))
			
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
			
			if (typeof recipients == 'string') {
					
			    var	t = recipients;
					
			    recipients = new Array();
			    recipients.push(t);
					
			} 
						
			sendRecipients = recipients;					
			sendRecipientsIndex = 0;
			sendMail = email;
			sendCallback = callback;
				
			state = STATES.SENDING_MAIL;
			smtpClient.sendMAIL('<' + from + '>', sendRecipientCallback);
		
		}
				
		var forceClose = function () {
			
			state = STATES.TERMINATED;
			if (smtpClient != null) {
			
				smtpClient.forceClose();		
				smtpClient = null;

			}
		
		}
		this.forceClose = forceClose;
		
		// Send QUIT command, this is the proper way to disconnect from a SMTP server.
		
		this.quit = function (callback) {
		
			if (state != STATES.IDLE) 
			
				throw new SMTPException(SMTPException.INVALID_STATE);
				
			else {
			
				smtpClient.sendQUIT(function (reply) {
			
					forceClose();
					if (typeof callback == 'function') 
					
						callback(reply.isPositiveCompletion(), reply.getLines());

				});
			
			}
		
		}
		
		// If arguments are given, connect on creation.
			
		if (arguments.length > 0) 
			
			this.connect(address, port, isSSL, domain, callback);
		
	}
	
	return SMTP;

}

var SMTP	= SMTPScope();

// Create a new SMTP client.

var createClient = function (address, port, isSSL, domain, callback) {

	return new SMTP(address, port, isSSL, domain, callback);

}

// Submit (send) a mail to a SMTP server. All arguments are mandatory. Last argument can be a Mail object, with its 
// header (fields) and body filled. Or it can be a email addresses of sender and recipient, followed by subject and 
// message content. For Wakanda, this function is synchronous and return true if successful.

var send = function (address, port, isSSL, username, password, from, recipient, subject, content) {

	var	isWakanda	= typeof requireNative != 'undefined';	
	var smtp		= new SMTP();
	var	mail		= require(isWakanda ? 'waf-mail/mail' : './mail.js');
	var	status		= false;

	if (typeof address != 'string' || typeof port != 'number' || typeof isSSL != 'boolean'
	|| typeof username != 'string' || typeof password != 'string') 

		throw new smtp.SMTPException(smtp.SMTPException.INVALID_ARGUMENT);
	
	// Accept both a mail object or "set" of arguments.
	
	var email;
	
	if (arguments.length == 6)
	
		email = arguments[5];
				
	else if (typeof from != 'string' || typeof recipient != 'string' 
	|| typeof subject != 'string' || typeof content != 'string')
		
		throw new smtp.SMTPException(smtp.SMTPException.INVALID_ARGUMENT);
		
	else
		
		email = mail.createMessage(from, recipient, subject, content);	
		
	// Event loop exit function. For wakanda, use exitWait() to get out of wait(). Otherwise, close SMTP client, this
	// will get out of event loop.
		
	var exit = function () {
	
		if (isWakanda)
		
			exitWait();
			
		else
		
			smtp.forceClose();
	
	}
			
	smtp.connect(address, port, isSSL, '', function (isOk, replyLines) {
				 
		if (!isOk)
		
			exit();
			
		else
		
			smtp.authenticate (username, password, function (isOk, replyLines) {

				if (!isOk) 
			
					exit();

				else
				
					smtp.send(email.From, email.To, email, function (isOk, replyLines) {

						status = isOk;
						if (isOk)

							smtp.quit(function (isOk, replyLines) {

								exit();

							});
								
					});
					
			});

	});
	
	if (isWakanda) {
	
		// Asynchronous connection and sending.
	
		wait();
	
		// Force freeing of resources.
	
		smtp.forceClose();
		
	}
	
	return status;
	
}

exports.createClient = createClient;
exports.send = send;
exports.SMTP = SMTP;
