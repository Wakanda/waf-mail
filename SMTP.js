/*
* This file is part of Wakanda software, licensed by 4D under
*  (i) the GNU General Public License version 3 (GNU GPL v3), or
*  (ii) the Affero General Public License version 3 (AGPL v3) or
*  (iii) a commercial license.
* This file remains the exclusive property of 4D and/or its licensors
* and is protected by national and international legislations.
* In any event, Licensee's compliance with the terms and conditions
* of the applicable license constitutes a prerequisite to any use of this file.
* Except as otherwise expressly stated in the applicable license,
* such license does not include any other license or rights on this file,
* 4D's and/or its licensors' trademarks and/or other proprietary rights.
* Consequently, no title, copyright or other proprietary rights
* other than those specified in the applicable license is granted.
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

	var	isWakanda			= typeof requireNative != 'undefined';
		
	var validEmailRegExp	= /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,4}/;
	
	var mail;
	var smtp;			
	var threeDigitReply;

	if (isWakanda) {

		smtp = require('waf-mail/smtpClient');
		threeDigitReply = require('waf-mail/threeDigitReply');
		mail = require('waf-mail/mail');

	} else {

		smtp = require('./smtpClient.js');
		threeDigitReply = require('./threeDigitReply.js');
		mail = require('./mail.js');

	}
	
	// Exception for SMTP, see codes below.
	
	var SMTPException  = function (code) {
	
		this.code = code;
	
	}
	SMTPException.INVALID_STATE		= -1;	// Command or operation can't be performed in current state.
	SMTPException.INVALID_ARGUMENT	= -2;	// At least an argument is wrong.
	SMTPException.NO_AUTH_LOGIN		= -3;	// SMTP server doesn't support "AUTH LOGIN".
	
	// If arguments are given, connect to server on creation.	

	function SMTP (address, port, isSSL, domain, callback) {
				
		var state		= STATES.NOT_CONNECTED;
		var smtpClient	= new smtp.SMTPClient();
		
		var nonSSLDomain, is8BitMIME, supportBDAT;
		
		this.SMTPException = SMTPException;
		
		// Connect to a SMTP server. All arguments except callback are mandatory. Note that some SMTP servers require 
		// domain to be specified, you may use an empty string if not needed. Callback has an additional third boolean
		// argument, indicating if the connected server is ESMTP, and a fourth, an array of lines, containing the
		// extensions if any. connect() function will always try to use the EHLO command before HELO.
		
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
							if (typeof callback == 'function') {
					
								if (helloCommand == smtpClient.sendEHLO)
								
									callback(true, reply.getLines(), true, smtpClient.getExtensions());
									
								else
								
									callback(true, reply.getLines(), false);
								
							}
					
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
		// Caller is supposed to have checked that SMTP server support "AUTH LOGIN".
		
		this.authenticate = function (user, password, callback) {
	
			if (state != STATES.IDLE) 
		
				throw new SMTPException(SMTPException.INVALID_STATE);
		
			else if (typeof user != 'string' || typeof password != 'string') {
			
				// Invalid parameter.
				
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
			
			} else {
			
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
					
						// Upgrade to SSL. Specification requests that a EHLO command is sent again.
						// Do so with domain used by initial EHLO (from server's greeting). Wait a 
						// few (100) milliseconds before doing so.
				    
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
		
		// Used by both DATA and BDAT sending methods.
		
		var sendContentCompletionCallback = function (reply) {
		
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
				
				// If not already done, set specified body type.
				// An empty line separates header and body.
				// If email uses MIME, add boundary before body.
								
				var bodyType	= sendMail.getBodyType();
				var mimeMessage	= sendMail.getMIMEMessage();
				
				if (mimeMessage != null) {
				
					smtpClient.sendContent('\r\n--' + mimeMessage.boundary + '\r\n');
					
					// If body type is unspecified, uses "text/stream".
					
					if (bodyType != null)
					
						smtpClient.sendContent('Content-Type: ' + bodyType + '\r\n\r\n');
						
					else
					
						smtpClient.sendContent('Content-Type: text/plain\r\n\r\n');

				} else {
				
					// Note that if 'Content-Type' has already been specified in the headers, 
					// this will add one more.
				
					if (bodyType != null)
					
						smtpClient.sendContent('Content-Type: ' + bodyType + '\r\n');
						
					smtpClient.sendContent('\r\n');
				
				}
				 
				// Send body if any.
				
				var body	= sendMail.getBody();
				
				for (i = 0; i < body.length; i++) {
				
					smtpClient.sendContent(body[i]);
					smtpClient.sendContent('\r\n');
				
				}
				
				// Send attachments if any.
					
				if (mimeMessage != null) {
				
					smtpClient.sendContent('\r\n');
				
					var	buffer = mimeMessage.toBuffer(is8BitMIME ? 1 : 0);
					
					smtpClient.sendContent(buffer);
				
				}
					
				// A single dot on a line terminates an email.				

				smtpClient.sendContentTerminator(sendContentCompletionCallback);
			
			}		
		
		}

		// Send header using BDAT command.
		
		var sendHeader = function () {
		
			var header			= sendMail.getHeader();
			var allocationSize	= 0;
						
			for (var i = 0; i < header.length; i++)
				
				allocationSize += (header[i].length + 1) * 2;	// Add two bytes for CRLF.
				
			var	buffer	= new Buffer(allocationSize);
			var	size	= 0;
						
			for (var i = 0; i < header.length; i++) {
				
				buffer.write(header[i], size);
				size += buffer._charsWritten;
				buffer.writeUInt16BE(0x0d0a, size);
				size += 2;
		
			}
			
			// Do not send header/body line break, sendBody() will do it.
			
			smtpClient.sendBDAT(buffer.slice(0, size), false, sendBody);
						
		}
		
		// Send body using BDAT command.
		
		var sendBody = function (reply) {

			if (!reply.isPositiveCompletion()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
		
			} else {

				var body			= sendMail.getBody();
				var allocationSize	= 0;
						
				for (var i = 0; i < body.length; i++)
				
					allocationSize += (body[i].length + 1) * 2;	// Add two bytes for CRLF.
			
				// Allocate buffer. And specify body type, see comments in sendContentCallback().
				
				var buffer;
				var bodyType	= sendMail.getBodyType();
				var mimeMessage	= sendMail.getMIMEMessage();
				var size		= 0;
								
				if (bodyType == null)
				
					buffer = new Buffer(allocationSize + 256);
					
				else
				
					buffer = new Buffer(allocationSize + bodyType.length * 2 + 128);
				
				if (mimeMessage != null) {
				
					buffer.write('\r\n--' + mimeMessage.boundary + '\r\n', size);
					size += buffer._charsWritten;
					
					if (bodyType != null)
					
						buffer.write('Content-Type: ' + bodyType + '\r\n\r\n', size);
						
					else
					
						buffer.write('Content-Type: text/plain\r\n\r\n', size);
						
					size += buffer._charsWritten;

				} else {
								
					if (bodyType != null) {
					
						buffer.write('Content-Type: ' + bodyType + '\r\n', size);
						size += buffer._charsWritten;
						
					}
					buffer.write('\r\n', size);
					size += buffer._charsWritten;
				
				}
				
				for (i = 0; i < body.length; i++) {
				
					buffer.write(body[i], size);
					size += buffer._charsWritten;
					buffer.writeUInt16BE(0x0d0a, size);
					size += 2;

				}
				
				if (mimeMessage != null) {
				
					buffer.writeUInt16BE(0x0d0a, size);
					size += 2;
					smtpClient.sendBDAT(buffer.slice(0, size), false, sendAttachments);
				
				} else 
				
					smtpClient.sendBDAT(buffer.slice(0, size), true, sendContentCompletionCallback);
					
			}
	
		}

		// Send attachments using BDAT command.
		
		var sendAttachments = function (reply) {

			if (!reply.isPositiveCompletion()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
		
			} else

				smtpClient.sendBDAT(sendMail.getMIMEMessage().toBuffer(1), true, sendContentCompletionCallback);

		}	
		
		var sendDataCallback = function (reply) {
		
			if (!reply.isPositiveCompletion()) {
			
				state = STATES.IDLE;
				if (typeof sendCallback == 'function') 
				
					sendCallback(false, reply.getLines());		
				
			} else if (supportBDAT)
			
				sendHeader();
			
			else
			
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
		
		var extractRecipients = function (email, name, resultArray) {
		
			var	r	= email.getField(name);

			if (typeof r == 'string')
			
				resultArray.push(r);
				
			else if (r instanceof Array) {
			
				var	i;
				
				for (i = 0; i < r.length; i++)
				
					resultArray.push(r[i]);
						
			}		
		
		}

		// Send an email. 
		//
		//	from:			the sender of email;
		//	recipients:		the recipient or an array of recipients (String), note "Cc" and "Bcc" are checked and 
		//					added to recipients;
		//	email:			a Mail object which is the mail to send, all its fields must have been set;
		//	callback:		called upon success or failure: first argument is true if successful, second
		//					argument is the lines of the last reply.
		
		this.send = function (from, recipients, email, callback) {

			if (state != STATES.IDLE)

				throw new SMTPException(SMTPException.INVALID_STATE);
								
			if (typeof from != 'string' 
			|| !(email instanceof mail.Mail)
			|| (typeof callback != 'function' && typeof callback != 'undefined'))
			
				throw new SMTPException(SMTPException.INVALID_ARGUMENT);
			
			if (typeof recipients == 'string') {
					
			    var	t = recipients;
					
			    recipients = new Array();
			    recipients.push(t);
					
			} else if (!(recipients instanceof Array)) {
			
				// If recipients is not an Array, create one.
			
				recipients = new Array();
				
			}
			
			// Add "Cc" and "Bcc" to recipients.
			
			extractRecipients(email, 'cc', recipients);
			extractRecipients(email, 'bcc', recipients);
			extractRecipients(email, 'Cc', recipients);
			extractRecipients(email, 'Bcc', recipients);
			
			// Add header fields for MIME attachments.
			
			var mimeMessage	= email.getMIMEMessage();
			
			if (mimeMessage != null) {

				// Make sure there is only one "Content-Type" field in header. 
				// Otherwise, some mail client may not decode message correctly as MIME multipart.

				for (var k in email) 
				
					if (typeof email[k] == 'string' && k.match(/^content\-type$/i) != null)
				
						delete email[k];
				
				// Add MIME version and "Content-Type" field.
			
				email.addField('MIME-Version', '1.0');
				email.addField('Content-Type', 'multipart/mixed; boundary="' + mimeMessage.boundary + '"');
			
			}
			
			// "Parse" recipients (check validity of emails).
			
			sendRecipients = new Array();
						
			for (var i = 0; i < recipients.length; i++) {
			
				if (typeof recipients[i] != 'string')

					continue;
					
				var	matchedEmail;
				
				if ((matchedEmail = recipients[i].match(validEmailRegExp)) == null || !matchedEmail.length)
				
					continue;
					
				sendRecipients.push(matchedEmail[0]);
	
			}			
						
			sendRecipientsIndex = 0;
			sendMail = email;
			sendCallback = callback;
			
			var extensions	= smtpClient.getExtensions();
			
			is8BitMIME = supportBDAT = false;
			if (typeof extensions == 'object' && extensions instanceof Array) {
			
				for (var i = 0; i < extensions.length; i++)  {
					
					if (extensions[i].search('8BITMIME') != -1)
					
						is8BitMIME = true;
						
					else if (extensions[i].search('CHUNKING') != - 1) 
					
						supportBDAT = true;					
					
				}
			
			}
			
			state = STATES.SENDING_MAIL;
			smtpClient.sendMAIL('<' + from + '>', is8BitMIME, sendRecipientCallback);
		
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
// message content. For Wakanda, this function is synchronous and return a status if successful.
//
// If the SMTP server is connected using a non SSL socket and supports STARTTLS, then the connection will be 
// automatically upgraded to SSL. This is better for security, of course. But in SSL mode, server will probably 
// support "AUTH LOGIN" (send username and password in base64 encoded form), whereas it may not in non secured 
// connections.
//
// The returned status has an isOk attribute telling if the command is successful or not. The action attribute tells
// more detail in case of failure. Attribute smtp.text (an Array of string(s)) and smtp.code attributes return the 
// last "three-digit" reply from server. See below for the constant definitions of the actions.

var	actionDoneSuccessful		= 0;
var	actionFailedToConnect		= 1;
var	actionFailedStartTLS		= 2;
var	actionFailedToAuthenticate	= 3;
var	actionUnableToAuthenticate	= 4;
var	actionFailedToSend			= 5;
var actionFailedToQuitProperly	= 6;

var send = function (address, port, isSSL, username, password, from, recipient, subject, content) {

	var	isWakanda	= typeof requireNative != 'undefined';	
	var smtp		= new SMTP();
	var	mail		= require(isWakanda ? 'waf-mail/mail' : './mail.js');
	var	status		= { action: -1, isOk: false, smtp: {} };

	if (typeof address != 'string' || typeof port != 'number' || typeof isSSL != 'boolean'
	|| typeof username != 'string' || typeof password != 'string') 

		throw new smtp.SMTPException(smtp.SMTPException.INVALID_ARGUMENT);
	
	// Accept both a mail object or "set" of arguments.
		  
	var email;
	
	if (arguments.length == 6)
	
		email = arguments[5];
				
	else if (typeof from != 'string' || (typeof recipient != 'string' && !(recipient instanceof Array))
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
	
	// Check extensions for STARTTLS.
	
	var supportSTARTTLS = function (extensions) {
	
		if (typeof extensions == 'undefined')
		
			return false;
			
		var	i;
		
		for (i = 0; i < extensions.length; i++) 
		
			if (extensions[i].match(/STARTTLS/) != null)
			
				return true;
	
		return false;
	}
	
	// Check for "AUTH LOGIN" support.

	var supportAUTH_LOGIN = function (extensions) {
	
		if (typeof extensions == 'undefined')
		
			return false;
			
		var	i;
		
		for (i = 0; i < extensions.length; i++) 
		
			if (extensions[i].match(/^AUTH/) != null && extensions[i].match(/LOGIN/) != null)
			
				return true;
	
		return false;
	}
	
	// Authenticate and send email.

	var authenticateAndSend = function () {
	
		smtp.authenticate(username, password, function (isOk, replyLines) {

			if (!isOk) {
			
				status.action = actionFailedToAuthenticate;
				status.isOk = isOk;
				status.smtp.text = replyLines;
				exit();

			} else {
			
				var	from, to;
				
				from = typeof email.From == 'string' ? email.From : email.from;
				to = typeof email.To != 'undefined' ? email.To : email.to;			// Can be a String or an array of String.
					 
				smtp.send(from, to, email, function (isOk, replyLines) {

					if (!isOk) {

						status.action = actionFailedToSend;
						status.isOk = isOk;
						status.smtp.text = replyLines;
						exit();
						
					} else

						smtp.quit(function (isOk, replyLines) {
						
							// Event if QUIT command is erroneous but send is successful, 
							// still consider that as a success.
							
							status.action = isOk ? actionDoneSuccessful : actionFailedToQuitProperly;
							status.isOk = true;
							status.smtp.text = replyLines;							
							exit();

						});
														
				});
				
			}
					
		});
		
	}
	
	smtp.connect(address, port, isSSL, '', function (isOk, replyLines, isESMTP, extensions) {
				 
		if (!isOk) {

			status.action = actionFailedToConnect;
			status.isOk = isOk;
			status.smtp.text = replyLines;		
			exit();
			
		} else if (isESMTP) {
		
			if (isSSL == false && supportSTARTTLS(extensions) && isWakanda) {
			
				// If non SSL connection and SMTP server supports STARTTLS, then upgrade to secured.
				
				smtp.starttls(function (isOk, replyLines) {
				
					if (!isOk) {

						status.action = actionFailedStartTLS;
						status.isOk = isOk;
						status.smtp.text = replyLines;					
						exit();

					} else

						authenticateAndSend();
				
				});			
			
			} else if (supportAUTH_LOGIN(extensions)) {
			
				// Usual case: sending on a secured or not connection.
			
				authenticateAndSend();			

			} else {
			
				// If no support for "AUTH LOGIN", we won't be able to authenticate, exit with error.
				
				status.action = actionUnableToAuthenticate;
				status.isOk = false;
				exit();
				throw new smtp.SMTPException(smtp.SMTPException.NO_AUTH_LOGIN);
			
			}
			
		} else {
		
			// Connected to non ESMTP server (is there still any around?).
			// Suppose that "AUTH LOGIN" is supported.
		
			authenticateAndSend();
		
		}
		
	});
			
	if (isWakanda) {
	
		// Asynchronous connection and sending.
	
		wait();
	
		// Force freeing of resources.
	
		smtp.forceClose();
		
	}
	
	// Retrieve the error code of last command reply from SMTP server.
	
	if (typeof status.smtp.text != 'undefined' && typeof status.smtp.text[0] == 'string')
	
		status.smtp.code = parseInt(status.smtp.text[0].substring(0, 3));
	
	return status;
	
}

// Here are the codes for the status.action attribute, they tell where the send() function failed.

send.ACTION_UNKNOWN					= -1;
send.ACTION_DONE_SUCCESSFUL			= actionDoneSuccessful;
send.ACTION_FAILED_TO_CONNECT		= actionFailedToConnect;
send.ACTION_FAILED_STARTTLS			= actionFailedStartTLS;
send.ACTION_FAILED_TO_AUTHENTICATE	= actionFailedToAuthenticate;
send.ACTION_UNABLE_TO_AUTHENTICATE 	= actionUnableToAuthenticate;
send.ACTION_FAILED_TO_SEND			= actionFailedToSend;
send.ACTION_QUIT_COMMAND_ERRONEOUS	= actionFailedToQuitProperly;

exports.createClient = createClient;
exports.send = send;
exports.SMTP = SMTP;
