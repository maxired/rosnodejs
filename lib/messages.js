var fs        = require('fs')
  , path      = require('path')
  , md5       = require('MD5')
  , makeError = require('makeerror')
  , packages  = require('./packages')
  ;

var messages = exports;

var registry = {};

var InvalidMessageError = exports.InvalidMessageError = makeError(
  'InvalidMessageError',
  "Message {name} is invalid"
);

var BadMessageFieldError = exports.BadMessageFieldError = function(obj){
  return makeError('BadMessageFieldError',
                  "Field {field} does not exist in message {name} definition",
                  { proto: InvalidMessageError(obj) })
};

var InvalidTypeMessageFieldError = exports.InvalidTypeMessageFieldError = function(obj){
  return makeError('InvalidTypeMessageFieldError',
                  "Field {field} has not the good type",
                  { proto: InvalidMessageError(obj) });
};

var OutOfRangeMessageFieldError = exports.OutOfRangeMessageFieldError = function(obj){
  return makeError('OutOfRangeMessageFieldError',
  "Message field {field} with value '{value}' is out of range '{range}' because it is defined as '{type}'",
  { proto: InvalidMessageError(obj) });
};

messages.parseMessageFile = function(fileName, callback) {
  fs.readFile(fileName, 'utf8', function(error, content) {
    if (error) {
      return callback(error);
    }
    else {
      var fields = extractFields(content) || [];
      var hash = md5(content);
      callback(null, fields, hash);
    }
  })
};

messages.getMessage = function(messageId, callback) {
  var packageName = getPackageNameFromMessageId(messageId);
  var messageName = getMessageNameFromMessageId(messageId);
  this.getMessageFromPackage(packageName, messageName, callback);
}

messages.getMessageFromPackage = function(packageName, messageName, callback) {
  var that = this;

  var messageId = getMessageId(packageName, messageName);
  var message = getMessageFromRegistry(messageId);
  if (message) {
    callback(null, message);
  }
  else {
    packages.findPackage(packageName, function(error, directory) {
      var filePath = path.join(directory, 'msg', messageName + '.msg');
      that.getMessageFromFile(messageId, filePath, callback);
    });
  }
};

messages.getMessageFromFile = function(messageId, filePath, callback) {
  var message = getMessageFromRegistry(messageId);
  if (message) {
    callback(null, message);
  }
  else {
    this.parseMessageFile(filePath, function(error, fields, hash) {
      if (error) {
        callback(error);
      }
      else {
        var packageName = getPackageNameFromMessageId(messageId)
          , messageName = getMessageNameFromMessageId(messageId)
          , entries   = getEntriesFromFields(fields)
          ;

        var details = {
          id          : messageId
        , messageName : messageName
        , packageName : packageName
        , fields      : fields
        , entries     : entries
        , md5         : hash
        };
        message = buildMessageClass(details);
        setMessageInRegistry(messageId, message);

        callback(null, message);
      }
    });
  }
};

function extractFields(content) {
  var fields = [];

  if (content) {
    var lines = content.split('\n');
    lines.forEach(function(line, index) {
      line = line.trim();

      var lineEqualIndex   = line.indexOf('=')
        , lineCommentIndex = line.indexOf('#')
        ;
      if (lineEqualIndex === -1
        || lineCommentIndex=== -1
        || lineEqualIndex>= lineCommentIndex)
      {
        line = line.replace(/#.*/, '');
      }

      if (line !== '') {
        var firstSpace = line.indexOf(' ')
          , fieldType  = line.substring(0, firstSpace)
          , field      = line.substring(firstSpace + 1)
          , equalIndex = field.indexOf('=')
          , fieldName  = field.trim()
          , constant   = null
          ;

        if (equalIndex !== -1) {
           fieldName = field.substring(0, equalIndex).trim();
           constant  = field.substring(equalIndex + 1, field.length).trim();
           fields.push({
             name: fieldName
           , type: fieldType
           , value: constant
           , index: fields.length + 1
           });
        }
        else {
          fields.push({
            name: fieldName.trim()
          , type: fieldType
          , index: fields.length+1
          });
        }
      }
    });
  }

  return fields;
};

function getEntriesFromFields(fields) {
  return fields.map(function(field) {
    return getJSFieldName(field);
  });
}

function camelCase(underscoreWord, lowerCaseFirstLetter) {
  var camelCaseWord = underscoreWord.split('_').map(function(word) {
    return word[0].toUpperCase() + word.slice(1);
  }).join('');

  if (lowerCaseFirstLetter) {
    camelCaseWord = camelCaseWord[0].toLowerCase() + camelCaseWord.slice(1)
  }

  return camelCaseWord;
}

function getJSFieldName(field) {
  var fieldName = null;
  if (field.value !== undefined) {
    fieldName = field.name;
  }
  else {
    fieldName = camelCase(field.name, true);
  }

  return fieldName;
}

function buildValidator (details) {
  // validates an object for being a valid message according to details.
  // if strict is true, no other enumerable key is allowed in candidate to be validated,
  // but allows partial messages
  function validator (candidate, /*optional*/strict) {
    return Object.keys(candidate).every(function(prop) {
      var valid = true;
      var exist = !!~details.entries.indexOf(prop); // checks if prop is in the entries array
      if (strict) {
        return exist;
      }
      //FIXME ensure type!
      return valid;
    });
  }
  validator.name = "validate" + camelCase(details.messageName);
  return validator;
}

function buildMessageClass(details) {
  function Message(values) {
    if (!(this instanceof Message)) {
      return new Message(init);
    }

    var that = this;

    if (details.fields) {
      details.fields.forEach(function(field) {
        that[getJSFieldName(field)] = field.value || '';
      });
    }

    if (values) {
      Object.keys(values).forEach(function(name) {
        that[name] = values[name];
      });
    }
  };

  Message.id          = details.id;
  Message.packageName = details.packageName;
  Message.messageName = details.messageName;
  Message.md5         = details.md5;
  Message.fields      = details.fields;
  Message.prototype.validate = buildValidator(details);
  return Message;
}

function getMessageFromRegistry(messageId) {
  return registry[messageId];
}

function setMessageInRegistry(messageId, message) {
  registry[messageId] = message;
}

function getMessageId(packageName, messageName) {
  return packageName ? packageName + '/' + messageName
                     : messageName;
}

function getPackageNameFromMessageId(messageId) {
  return messageId.indexOf('/') !== -1 ? messageId.split('/')[0]
                                       : '';
}

function getMessageNameFromMessageId(messageId) {
  return messageId.indexOf('/') !== -1 ? messageId.split('/')[1]
                                       : messageId;
}
