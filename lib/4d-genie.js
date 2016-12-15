var events = require('events');
var SerialPort = (serialport = require('serialport'));

function Genie(defaultForm) {
    var self = this;

	this.status		= 0;
    this.callbacks  = [ ];
    this.commands   = [ ];
    this.current    = 0;
    this.buffer     = new Buffer(1024);
    this.activeForm = defaultForm || 0;
    
    self.on('response', function () {
        if (self.wait === null && self.commands.length) {
            var command = self.commands.shift();
            self.callbacks.push(command.callback);
            self.serialport.write(command.buffer);
        }
    });
}
require('util').inherits(Genie, events.EventEmitter);

Genie.ACK                  = 0x06,
Genie.NAK                  = 0x15;

Genie.READ_OBJ             =  0,
Genie.WRITE_OBJ            =  1,
Genie.WRITE_STR            =  2,
Genie.WRITE_STRU           =  3,
Genie.WRITE_CONTRAST       =  4,
Genie.REPORT_OBJ           =  5,
Genie.REPORT_EVENT         =  7,
Genie.MAGIC_BYTES          =  8,
Genie.DOUBLE_BYTES         =  9,
Genie.REPORT_MAGIC_BYTES   = 10,
Genie.REPORT_DOUBLE_BYTES  = 11;

Genie.OBJ_DIPSW            =  0,
Genie.OBJ_KNOB             =  1,
Genie.OBJ_ROCKERSW         =  2,
Genie.OBJ_ROTARYSW         =  3,
Genie.OBJ_SLIDER           =  4,
Genie.OBJ_TRACKBAR         =  5,
Genie.OBJ_WINBUTTON        =  6,
Genie.OBJ_ANGULAR_METER    =  7,
Genie.OBJ_COOL_GAUGE       =  8,
Genie.OBJ_CUSTOM_DIGITS    =  9,
Genie.OBJ_FORM             = 10,
Genie.OBJ_GAUGE            = 11,
Genie.OBJ_IMAGE            = 12,
Genie.OBJ_KEYBOARD         = 13,
Genie.OBJ_LED              = 14,
Genie.OBJ_LED_DIGITS       = 15,
Genie.OBJ_METER            = 16,
Genie.OBJ_STRINGS          = 17,
Genie.OBJ_THERMOMETER      = 18,
Genie.OBJ_USER_LED         = 19,
Genie.OBJ_VIDEO            = 20,
Genie.OBJ_STATIC_TEXT      = 21,
Genie.OBJ_SOUND            = 22,
Genie.OBJ_TIMER            = 23,
Genie.OBJ_SPECTRUM         = 24,
Genie.OBJ_SCOPE            = 25,
Genie.OBJ_TANK             = 26,
Genie.OBJ_USERIMAGES       = 27,
Genie.OBJ_PINOUTPUT        = 28,
Genie.OBJ_PININPUT         = 29,
Genie.OBJ_4DBUTTON         = 30,
Genie.OBJ_ANIBUTTON        = 31,
Genie.OBJ_COLORPICKER      = 32,
Genie.OBJ_USERBUTTON       = 33,
Genie.OBJ_MAGIC            = 34;


Genie.prototype.readObject = function (obj, index, callback) {
    this.directWrite(callback,[Genie.READ_OBJ, obj, index]);
};

Genie.prototype.writeObject = function (obj, index, msb, lsb, callback) {
    var self = this;

    // Prevent screen flicker
    if (obj == Genie.OBJ_FORM && index == this.activeForm) {
        if (callback) {
            callback(null, true);
        }

        return;
    }

    this.directWrite(callback, [Genie.WRITE_OBJ, obj, index, msb, lsb]);

    if (obj == Genie.OBJ_FORM) {
        this.activeForm = index;
    }
};

Genie.prototype.writeString = function (index, str, callback) {
    if (typeof str !== 'string') {
        str = '';
    }

    var buf = Buffer(str, 'ascii').toJSON();
    this.directWrite(callback, [Genie.WRITE_STR, index, str.length].concat(buf.data));
};

Genie.prototype.writeContrast = function (value, callback) {
    this.directWrite(callback, [Genie.WRITE_CONTRAST, value]);
};

Genie.prototype.connect = function(serialport_name, opts) {
    var self = this;

    this.serialport_name = serialport_name;
    
    if (opts == null) {
        opts = {
            baudrate: 9600
        };
    }

    //opts.parser = serialport.parsers.raw;

    this.serialport = new SerialPort(this.serialport_name, opts);
    this.serialport.once('open', function() {
        //console.log("open");
        self.status = 1;
        self.emit('connect');
    });
    
    this.serialport.on('data', function parse(data) {        
        if (self.current === 0) {
            switch(data[0]) {
                case Genie.ACK:
                case Genie.NAK:
                    self.wait = 1;
                    break;
                case Genie.REPORT_OBJ:
                case Genie.REPORT_EVENT:
                    self.wait = 6;
                    break;
            }
        }

        for (var i = 0; i < data.length; i++) {
            self.buffer[self.current] = data[i];
            self.current++;
        }

        if (self.current < self.wait) {
            return;
        }

        var tmpBuf = self.buffer.slice(0, self.wait == 1 ? 1 : self.wait - 1);
        var checksum = self.buffer.readUInt8(self.wait - 1);

        var cb = self.callbacks.shift();

        if (cb) {
            if (makeChecksum(tmpBuf) == checksum) {
                cb(null, tmpBuf);
            }
            else {
                cb("bad checksum", self.buffer.slice(0, self.wait));
            }
        }
        else if(tmpBuf.readUInt8(0) === Genie.REPORT_EVENT) {
            self.emit('GenieEvent', {cmd: tmpBuf.readUInt8(0), obj: tmpBuf.readUInt8(1), index: tmpBuf.readUInt8(2), msb: tmpBuf.readUInt8(3), lsb: tmpBuf.readUInt8(4)});
        }

        self.current = 0;
        self.wait = null;
        self.emit('response');
    });

    return this;
}

Genie.prototype.defaultCallback = function (err, data) {
    //console.dir(data);
};

function makeChecksum(command) {
    var checksum;
    for (var i = 0; i < command.length; i++) {
        if (i === 0) {
            checksum = command[i];
        }
        else {
            checksum ^= command[i];
        }
    }
    
    return checksum;
}

Genie.prototype.directWrite = function (callback, command) {
    if (callback === undefined) {
        callback = this.defaultCallback;
    }

    command.push(makeChecksum(command));
    
    this.queue({ callback: callback, buffer: new Buffer(command) });
};

Genie.prototype.queue = function (command) {
    if (this.callbacks.length === 0) {
        this.callbacks.push(command.callback);
        this.serialport.write(command.buffer);
    }
    else {
        this.commands.push(command);
    }
};

module.exports = Genie;