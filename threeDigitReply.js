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

// "Three-digit" reply used by SMTP and FTP protocols.   
//
// References:
//
// 		http://www.ietf.org/rfc/rfc5321.txt (SMTP, section 4.2)
//		http://www.ietf.org/rfc/rfc959.txt (FTP, section 4.2)
//
// Note:
//
//		Low-level library, to be used with SMTPClient and FTPClient.
//
// Usage:
//
//		Data from socket is feed to readData() which will return an error code indicating if the reply has been read 
//		completely (the number of line(s) read, a positive number), if more data is expected (zero), or if an error 
//		occured (a negative number, see error constants) while reading reply. 
//
//		Then use getCode() to retrieve code (a string) of the reply. And getLines() to retrieve the array of line(s) 
//		making up the reply. The line(s) are unprocessed, code(s) starting them are left. End user should call isOk() 
//		to make sure reply has been read properly. If not, getCode(), getLines(), etc will throw an exception.

function ThreeDigitReplyScope () {
	
	var	codeRegExp	= /^([2-5][0-5]\d)(-| )/;
	
	var ThreeDigitReplyException = function () {
	
		// Thrown if reply has not been properly read and trying retrieve content (getLines()) of reply.
	
	}
	
	function ThreeDigitReply () {

		this.OK					= 0;				// Reply has been successfully read.
		this.IN_PROGRESS		= -1;				// Currently reading reply.
		this.NO_DATA			= -2;				// Empty data is forbidden.
		this.INVALID_CODE		= -3;				// Lines must start by a valid code.
		this.CODES_DONT_MATCH	= -4;				// Codes in a reply must be same.
		this.EARLY_LAST_LINE	= -5;				// Last line indicator is not at last line of reply.
		

		var	errorCode			= this.IN_PROGRESS;	// Read status.
		var code				= null;				// Three-digit reply code;
		var lines				= new Array();		// All lines of the reply. Textual data starts at fourth character.
		var	isLinePending		= true;				// Middle of a line?.
		
		// Read reply data, return: 
		//
		//	*	a negative error constant if erroneous;
		//	*	zero if ongoing; 
		//	*	or the number of line(s) read if reply is complete and ok.
		
		this.readData = function (data) {
		
			var	array = data.split('\r\n');
				
			if (!array.length)
			
				return errorCode = this.NO_DATA;

			var i, j;
				
			if (isLinePending) {
				
				if (!lines.length)
					
					lines[0] = array[0];
					
				else {
				
					i = lines.length - 1;
					lines[i] = lines[i].concat(array[0]);
				
				}
				
				if (array.length == 1)
				
					return 0;	// No '\r\n' yet, line is not complete yet.
					
				else {
				
					isLinePending = false;
					i = 1;
					
				}
			
			} else 
					
				i = 0;
				
			j = lines.length;			
			if ((code = lines[j - 1].match(codeRegExp)) == null)
			
				return errorCode = this.INVALID_CODE;
				
			else
			
				code = code[0].substring(0, 3);
					
			for ( ; i < array.length - 1; i++, j++) {
				
				lines[j] = array[i];
			
				// Check for correctness. All codes must be the same, and last line indicator must be at last line!
			
				var		matched;

				if ((matched = lines[j].match(codeRegExp)) == null) 
			
					return errorCode = this.INVALID_CODE;	
			
				if (code != matched[0].substring(0, 3))
				
					return errorCode = this.CODE_DONT_MATCH;	
					
				if (matched[0].charAt(3) == ' ' && i != array.length - 2)
				
					return errorCode = this.EARLY_LAST_LINE;	// Premature last line.
				
			}
			
			if (array.length > 1 && array[i] != '') {
			
				lines[j] = array[i];
				isLinePending = true; 
				return 0;
			
			}  if (lines[j - 1].charAt(3) == ' ') {
		
				// Reply is complete.
		
				code = lines[j - 1].substring(0, 3);
				errorCode = this.OK;
				
				return j;
			
			} else
			
				return 0;

		}
		
		// Return true if the reply has been successfully read.
		
		this.isOk = function () {
		
			return errorCode == this.OK;
		
		}
		
		// Return error code, which can pinpoint a reading error, if any.
		
		this.getErrorCode = function () {
		
			return errorCode;
		
		}
		
		// Return three-digit code.
		
		this.getCode = function () {
		
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return code;
		
		}
		
		// Return reply line(s) as an Array of String.
		
		this.getLines = function () {
		
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return lines;
		
		}

		// Successful completion of command.
		
		this.isPositiveCompletion = function () {
			
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return code.charAt(0) == 2;
			
		}
		
		// Command accepted, but needs further data for completion.
		
		this.isPositiveIntermediate = function () {
			
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return code.charAt(0) == 3;
			
		}
		
		// Command failed, but error condition is transient. Should try again.
		
		this.isTransientNegativeCompletion = function () {
		
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
						
				return code.charAt(0) == 4;
			
		}
		
		// Erroneous command.
		
		this.isPermanentNegativeCompletion = function () {
			
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return code.charAt(0) == 5;
			
		}	
		
		// Return number of reply line(s).
		
		this.getNumberLines = function () {
		
			if (errorCode != this.OK)
			
				throw new ThreeDigitReplyException();
				
			else
			
				return lines.length;
		
		}

	}
	
	return ThreeDigitReply;
	
}
exports.ThreeDigitReply = ThreeDigitReplyScope();
