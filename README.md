waf-mail
==========

This is an easy to use module to send e-mails with Wakanda or Node.JS

It is also meant to be a complete advanced SMTP & POP3 client.


Installation
------------

The source for waf-mail is available at [GitHub](https://github.com/Wakanda/waf-mail).

### waf-mail for NodeJS

Install through *NPM* (soonly available)

    npm install waf-mail

or download [ZIP archive](https://github.com/Wakanda/waf-mail/zipball/master).

waf-mail is fully compatible with Node.js versions 0.3.x, 0.4.x and 0.5.x on *nix, and 0.5.x on Windows


### waf-mail for Wakanda

Download the [ZIP archive](https://github.com/Wakanda/waf-mail/zipball/master) and uncompress it in the "Module" folder of the Wakanda Server package.

waf-mail is fully compatible with Wakanda DP2 and upper on Linux, MacOS, & Windows


### Note

It should also be available next via [CPM (the CommonJS Package Manager)](https://github.com/kriszyp/cpm) proposed by [Krys Zip](https://twitter.com/#!/kriszyp)



Documentation
------------

Little example via createMessage():

    var username = 'john.smith'; // enter a valid account here
    var password = 'mypwx!2';  // enter a valid password here
    var address = 'smtp.4dmail.com'; 
    var port = 465;  // SSL port 
    var mail = require('waf-mail/mail');
    var message = mail.createMessage("from@4d.com", "to@4d.com", "Test", "Hello World!");
    message.send(address , port , true, username, password);

Read the full [documentation](http://doc.wakanda.org/SSJS-Modules/Mail.201-807580.en.html).


Issues
------

Report this module bugs, or feature requests in the [waf-mail GitHub Issue tracker](https://github.com/Wakanda/waf-mail/issues)
You can also ask support on the [Wakanda Troubleshooting forum](http://forum.wakanda.org/forumdisplay.php?4-Troubleshooting-forum) and report Wakanda specific bugs in the [Wakanda Bug base](http://bugs.wakanda.org/displaybugs)


License
-------

**waf-mail** is licensed under [MIT license](https://github.com/Wakanda/waf-mail/blob/master/MIT-LICENSE). 
Basically you can do whatever you want to with it.