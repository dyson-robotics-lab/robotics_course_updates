/* 
 * Variables and constants definitions.
 */

// Include the modules.
var app = require('http').createServer(handler)
  , fs = require('fs')
  , net = require('net')
  , spawn = require('child_process').spawn

// Third party modules.
var installedModules = {};

// These were installed by the install script.
var io = require('socket.io').listen(app);
var formidable = require('formidable');
  
// Install these requirements and run the server.
var carrier = require('carrier');
//requireAndInstall([{name: 'carrier', callback: function(callback) {
//    carrier = installedModules['carrier'];
//   if (callback) {
//      callback();
//    }
//  }}], setupServer()); 

setupServer();

// Stores the lines that should be drawn to the users that connect.
var lines = [];
var imgFilePaths = [];
var files = [];

// Defines the directory containing the python scripts.
var pythonDir = '/home/pi/prac-files/';
var pythonBackupDir = pythonDir + '.backups/';
// Create the necessary directories.
createDirIfNecessary(pythonDir);
createDirIfNecessary(pythonBackupDir);

// The public dir containing client code.
var publicDir = 'public/'

// Defines the commands that are used for drawing.
var graphicCommands = [
  {command: 'drawParticles', dataProcessor: drawParticlesProcessor},
  {command: 'drawPoints', dataProcessor: drawParticlesProcessor},
  {command: 'drawLine', dataProcessor: drawLineProcessor},
  {command: 'drawRobot', dataProcessor: drawRobotProcessor},
  {command: 'drawImg', dataProcessor: drawImgProcessor}
]

// Stores the details about the python process that is currently being run. Null if no process is running.
var runningProcess = null;

/* 
 * End variables and constants definitions.
 */

// Helper function for requiring third party modules. This function installs the modules if they are missing and then launches the server once done.
function requireAndInstall(modules, finishedCallback) {
  modules.forEach(function(module, index) {
    
    var simplyRequire = function () {
      console.log("Requiring " + module.name);
      installedModules[module.name] = require(module.name);
      if (index == modules.length - 1) {
        // Last element, make sure we call the overall callback.
        module.callback(finishedCallback);
      } else {
        module.callback();
      }
    }

    try {
      simplyRequire();
    } catch (e) {
      console.log("Required module " + module.name + " not found " + e);
      console.log("Installing module " + module.name);
      runCommand('npm', ['install', module.name], simplyRequire, function() {
        console.log("Error while installing " + module.name);
        console.log("npm possibly not on path, try absolute path.");
        runCommand('/usr/bin/npm', ['install', module.name], simplyRequire, function() {
          console.log("Failed to install " + module.name);
          console.log("Giving up.");
          throw Error('Failed to install the required module ' + module.name);
        });
      });
    }
  });
}

/* 
 * Main server functionality.
 */
 function setupServer() {
  // Define the port.
  app.listen(9000);
  console.log("Server started.");
  setupSockets();
  console.log("Sockets initialised.");
}

function setupSockets() {
  // Disable socket.io debug messages.
  io.set('log level', 1);

  // Broadcast the list of files every 5 seconds in case the user copies some files into the directory.
  setInterval(function() {
    sendFiles(null);
  }, 5000);

  // Execute when a user connects to the sever.
  io.sockets.on('connection', function (socket) {

    // Send list of files and initialisation data.
    sendFiles(socket);
    socket.emit('init', {runningProcess: runningProcess == null ? null : runningProcess.name, lines: lines});

    // Process the command to execute the python script.
    socket.on('execute', function (data) {
      console.log('Executing ' + data.filename);
      runningProcess = {name: data.filename, process: runPython(data.filename)};
    });

    // Process the command to terminate the python script.
    socket.on('terminate', function (data) {
      terminateRunningProcess();
    });

    /* TODO: Doesn't work. Would be nice to have later...
    // Process the command to terminate the python script.
    socket.on('shutdown', function (data) {
      console.log('Shutting down Pi.');
      if (runningProcess != null) {
        runningProcess.process.kill();
        runningProcess = null;
        lines = [];
        spawn('sudo', ['shutdown', 'now'], {stdio: 'inherit'});
      }
    });

    // Process the command to terminate the python script.
    socket.on('reboot', function (data) {
      console.log('Rebooting Pi.');
      if (runningProcess != null) {
        runningProcess.process.kill();
        runningProcess = null;
        lines = [];
        spawn('sudo', ['reboot'], {stdio: 'inherit'});
      }
    }); */

    socket.on('load-file', function(data) {
      console.log("Loading " + data.filename);
      servePracFile(data.filename, socket);
    });

    socket.on('save', function(data) {
      console.log("Saving " + data.filename);
      saveFile(data.filename, data.content, socket);
    });

    socket.on('delete', function(data) {
      console.log("Deleting " + data.filename);
      createBackup(data.filename, function(backupError) {
        if (backupError) {
          console.log('Backing up file ' + data.filename + ' failed.');
        }
        fs.unlink(pythonDir + data.filename, function (err) {
          if (err) {
            socket.emit('terminal-error', {output: 'Failed to delete ' + data.filename});
          };
          console.log('Deleted ' + data.filename);
          socket.emit('terminal', {output: 'Deleted ' + data.filename});
          sendFiles();
        });
      });
    });

  });
}

// Handles the http request.
function handler (req, res) {
  var header=req.headers['authorization']||'',        // get the header
      token=header.split(/\s+/).pop()||'',            // and the encoded auth token
      auth=new Buffer(token, 'base64').toString(),    // convert from base64
      parts=auth.split(/:/),                          // split on colon
      username=parts[0],
      password=parts[1];

  fs.readFile('passwd.md5', 'utf8', function (err,data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading password file. Did you forget to create it?' );
    } else {
      if (!password) {
        res.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="Pi Realm"'
        });
        res.end();
      } else {
        
        hashedPassword = require('crypto').createHash('md5').update(password).digest("hex").trim();
        if (username == "pi" && hashedPassword == data.trim()) {
          // The user was authenticated.
          
          // The routing.
          switch(req.url) {

            case '/upload':
              processUpload(req, res);
              break;

            case '/change-password':
              changePassword(req, res);
              break;

            case '/jquery':
              serveFile(req, res, 'jquery-2.1.0.min.js');
              break;

            case '/bootstrap-js':
              serveFile(req, res, 'bootstrap.min.js');
              break;

            case '/bootstrap-css':
              serveFile(req, res, 'bootstrap.min.css');
              break;

            case '/codemirror-js':
              serveFile(req, res, 'codemirror-compressed.js');
              break;

            case '/codemirror-css':
              serveFile(req, res, 'codemirror.css');
              break;

            case '/monokai':
              serveFile(req, res, 'monokai.css');
              break;

            default:
              serveFile(req, res, 'index.html');
              break;

          }
        
        } else {
          // Ask user to authenticate himself.
          res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Pi Realm"'
          });
          res.end();
        }
      }
    }
  });
}

process.on('uncaughtException', function (err) {
  console.log(err);
  io.sockets.emit('terminal-error', {output: 'The server code has encountered an unexpected errror and will terminate. Please restart the server. ' + err});
  terminateRunningProcess();
  throw err;
}); 

process.on('exit', function (code) {
  console.log('About to exit with code:', code);
  terminateRunningProcess();
});

//catches ctrl+c event
process.on('SIGINT', function () {
    process.exit();
});

/* 
 * End main server functionality.
 */

/* 
 * Functions definitions.
 */
// Parses the particles drawing command. Parses Python list of 3-tuples (x, y, theta) and creates the data to be sent via the socket.
function drawParticlesProcessor(data) {
  re = /\((\-?\d+(?:\.\d+)?), (\-?\d+(?:\.\d+)?)(?:, (\-?\d+(?:\.\d+)?))?(?:, (\-?\d+(?:\.\d+)?))?(?:, (\-?\d+(?:\.\d+)?))*\)/g; // Matches a python n-tuple of numbers for n >= 2.
  result = [];
  somethingMatched = false;
  var maxWeight = 0;
  while (matched = re.exec(data)) {
    var theta = null;
    if (matched[3]) {
      theta = matched[3];
    }
    var weight = 1;
    if (matched[4]) {
      weight = parseFloat(matched[4]);
      if (weight > maxWeight) {
        maxWeight = weight;
      }
    }
    result.push({x: matched[1], y: matched[2], theta: theta, weight: weight});
    somethingMatched = true;
  }
  if (somethingMatched) {
    if (maxWeight > 0) {
      result.forEach(function (entry) {
        entry.weight = 0.75 * entry.weight / maxWeight + 0.25;
      });
    }
    return result;
  } else {
    io.sockets.emit('terminal-error', {output:'Check your call for the drawParticles. You should do: \'print "drawParticles:" + str(particles)\' in your python code. Here particles should be a list of tuples, with the tuples specifying (x, y, theta?, weight?), where theta and weight are optional. If you pass in a tuple with more than 4 numbers, the additional numbers are ignored when drawing.'});
  }
}

// Parses the draw line command. Parses a 4-tuple (x0, y0, x1, y1) and creates the data to be sent via the socket.
function drawRobotProcessor(data) {
  re = /\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\)/; // Matches a python 3-tuple of numbers.
  if (matched = re.exec(data)) {
    var robot = {x: matched[1], y: matched[2], theta: matched[3]};
    return robot;
  } else {
    io.sockets.emit('terminal-error', {output:'Check the call for drawRobot. You should do: \'print "drawRobot:" + str(robot)\' in your python code. Here line should be a 3-tuple specifying (x, y, theta). When you print your robot variable, you should see something like \'(10, 15, 120)\'.'});
  }
}

// Parses the draw line command. Parses a 4-tuple (x0, y0, x1, y1) and creates the data to be sent via the socket.
function drawLineProcessor(data) {
  re = /\((\-?\d+(?:\.\d+)?), (\-?\d+(?:\.\d+)?), (\-?\d+(?:\.\d+)?), (\-?\d+(?:\.\d+)?)\)/; // Matches a python 4-tuple of numbers.
  if (matched = re.exec(data)) {
    line = {x0: matched[1], y0: matched[2], x1: matched[3], y1: matched[4]};
    lines.push(line);
    return (line);
  } else {
    io.sockets.emit('terminal-error', {output:'Check the output for the drawLine functionality. You should do: \'print "drawLine:" + str(line)\' in your python code. Here line should be a 4-tuple specifying (x0, y0, x1, y1). When you print your line variable, you should see something like \'(10, 15, 20, 30)\'.'});
  }
}

function drawImgProcessor(data) {
  re = /drawImg:(.*)/;
  if (matched = re.exec(data)) {
    filepath = {filepath: matched[1]};
    imgFilePaths.push(filepath);

    // d = fs.readFileSync(matched[1],(err, data) => {
    //   if (err) {
    //     io.sockets.emit('terminal-error', {output: err.message});
    //     return "err"
    //   } else {
    //     return data;
    //  }
    //});
    d = fs.readFileSync(matched[1]);
    console.log(d)
    return d;
  } else {
    io.sockets.emit('terminal-error', {output: 'Check the output for the drawImg functionality'});
 }
  return "why did I come here"

}

// Processes file uploads. Gets the file from the user and copies it from a temporary location to the working directory.
function processUpload(req, res) {
  if (req.method.toLowerCase() == 'post') {
    // parse a file upload
    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
      if (err) {
        res.writeHead(500);
        return res.end('File upload failed.');  
      }         
    });
    form.on('end', function(fields, files) {
      /* Temporary location of our uploaded file */
      var temp_path = this.openedFiles[0].path;
      /* The file name of the uploaded file */
      var file_name = this.openedFiles[0].name;
      
      var copyErrorShown = false;             
      var rs = fs.createReadStream(temp_path);
      rs.on("error", function(err) {
        io.sockets.emit('terminal-error', {output:'An error has occurred while uploading the file.'});
        copyErrorShown = true;
      });
      var ws = fs.createWriteStream(pythonDir + file_name);
      ws.on("error", function(err) {
        if (!copyErrorShown) {
          io.sockets.emit('terminal-error', {output:'An error has occurred while copying the file. Make sure you are not running the file you are trying to overwrite.'});
        }
      });
      ws.on("close", function(ex) {
        if (!copyErrorShown) {
          sendFiles();
        }
      });
      rs.pipe(ws);
    });
  }
}

function changePassword(req, res) {
  // TODO.
}

// Serves the given file from the public directory.
function serveFile(req, res, filename) {
  fs.readFile(__dirname + '/' + publicDir + filename,
    function (err, data) {
      if (err) {
        console.log(err);
        res.writeHead(500);
        return res.end('Error loading ' + filename);
      }

      res.writeHead(200);
      res.end(data);
    });
}

function servePracFile(filename, socket) {
  fs.readFile(pythonDir + filename,
    {encoding: 'utf8'},
    function (err, data) {
      if (err) {
        console.log(err);
        socket.emit('terminal-error', {output: "Couldn't load the file."});
      }
      socket.emit('show-file', {filename: filename, contents: data});
    });
}

// Sends the current list of files present in the working directory.
function sendFiles(socket) {
  fs.readdir(pythonDir, function(err, _files) {
    if (err) {
      console.log(err);
    }
    files = _files;
    if (socket == null) {
      io.sockets.emit('files', {files: _files});
    } else {
      socket.emit('files', {files: _files});
    }
  });
}

function createDirIfNecessary(dirname) {
  fs.mkdir(dirname,function(e) {
      if(!e) {
        console.log('Directory ' + dirname + ' created.');
      } else if(e && e.code === 'EEXIST') {
        console.log('Directory ' + dirname + ' already exists.');
      } else {
        console.log(e);
        throw e;
      }
  });
}

function saveFile(filename, content, socket) {
  createBackup(filename, function(err) {
    if (!err) {
      // Save the file.
      fs.writeFile(pythonDir + filename, content, function(err) {
        if(err) {
          console.log(err);
          socket.emit('save-failed', {filename: filename});    
        } else {
          console.log("The file was saved.");
          socket.emit('save-successful', {filename: filename});    
        }
      }); 
    } else {
      socket.emit('save-failed', {filename: filename});
    }
  }, socket); 
}

function createBackup(filename, callback, socket) {
  if (files.indexOf(filename) == -1) {
    callback();
  } else {
    console.log("Backing up file " + filename);
    var callbackCalled = false;
    var rs = fs.createReadStream(pythonDir + filename);
    rs.on("error", function(err) {
      console.log(err);
      if (!callbackCalled) {
        socket.emit('terminal-error', {output:'An error has occurred while creating a backup of the file ' + filename});
        callback(err);
        callbackCalled = true;
      }
    });
    var ws = fs.createWriteStream(pythonBackupDir + filename + '-' + new Date().getTime());
    ws.on("error", function(err) {
      console.log(err);
      if (!callbackCalled) {
        socket.emit('terminal-error', {output:'An error has occurred while copying the file ' + filename + '. Mak e sure you are not running the file you are trying to overwrite.'});
        callback(err);
        callbackCalled = true;
      }
    });
    ws.on("close", function(ex) {
      callback();
      console.log("Backed up file " + filename);
    });
    rs.pipe(ws);
  }
}

// Process the stdout from python scripts.
function processPythonOutput(data) {
  // Process the output and send it either as text output or in a json that will be drawn by the client.
  var lines = data.split("\n");
  lines.forEach(function (line) {
    var output = false;
    graphicCommands.forEach(function (entry) {
      if (!output) {
        commandPart = line.substring(0, entry.command.length + 1);
        if (commandPart === entry.command + ":") {
          // Found graphical displa, process and send it to socket.
          // console.log('Python: GRAPHIC - ' + line);
          io.sockets.emit('graphic', {name: runningProcess ? runningProcess.name : null, command: entry.command, data: entry.dataProcessor(line.substring(entry.length+1))});
          output = true;
        }
      }
    });

    // Just normal text display.
    if (!output && line.trim().length > 0) {
      // console.log('Python: ' + line);
      io.sockets.emit('terminal', {name: runningProcess ? runningProcess.name : null, output: line});;
    }

  });
}

// Runs the python script, sets up the listening for data and errors and defines how the data will be passed on to the client.
function runPython(filename) {
  if (runningProcess != null) {
    return;
  }

  child = spawn('python3', ['-u', filename], {cwd: pythonDir});

  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  var my_carrier = carrier.carry(child.stdout);
  my_carrier.on('line',  processPythonOutput);

  child.stderr.on('data', function(data) {
    console.log('Python: ERROR - ' + data);
    io.sockets.emit('terminal-error', {output:data});
  });
  child.stdout.on('end', function(data) {
    console.log('Python finished');
    runningProcess = null;
    io.sockets.emit('terminal-finished', {output: 'Script finished.'});;
  });
  return child;
}

function terminateRunningProcess() {
  if (runningProcess != null) {
    ret = runningProcess.process.kill(2);
    console.log('Terminating ' + runningProcess.name + ', success: ' + ret);
    runningProcess = null;
    lines = [];
    imgFilePaths = [];
  }
}

function runCommand(command, args, callback, fallback) {
  var child = spawn(command, args, {stdio: 'inherit'});
  child.on('error', function(e) {
    console.log(e);
    fallback();
  });
  child.on('exit', function(status, signal) {
    if (status != 0) {
      console.log('Error while installing ' + module.name);
      fallback();
    } else {
      callback();
    }
  });
}
/* 
 * End functions definitions.
 */
