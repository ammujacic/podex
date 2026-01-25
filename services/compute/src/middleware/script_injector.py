"""HTML response transformer for DevTools script injection.

This module provides functionality to inject a DevTools bridge script into
proxied HTML responses, enabling console capture, network monitoring, and
DOM inspection from the parent frame.
"""

from __future__ import annotations

import re

# The DevTools bridge script to inject into HTML responses
DEVTOOLS_BRIDGE_SCRIPT = """
<script data-podex-devtools="true">
(function() {
  // Prevent double injection
  if (window.__podexDevToolsInjected) return;
  window.__podexDevToolsInjected = true;

  // Message types for communication with parent frame
  const MSG = {
    CONSOLE: 'devtools:console',
    NETWORK_REQUEST: 'devtools:network:request',
    NETWORK_RESPONSE: 'devtools:network:response',
    ERROR: 'devtools:error',
    DOM_READY: 'devtools:dom:ready',
    DOM_SNAPSHOT: 'devtools:dom:snapshot',
    NAVIGATE: 'devtools:navigate',
    READY: 'devtools:ready',
  };

  // Size limits to prevent memory issues
  const LIMITS = {
    MAX_BODY_SIZE: 5000,      // 5KB max for request/response bodies
    MAX_CONSOLE_ARG_SIZE: 2000, // 2KB max per console argument
    MAX_DOM_DEPTH: 15,        // Max DOM tree depth for snapshots
    MAX_CHILDREN: 100,        // Max children per DOM node
  };

  // Generate unique IDs for requests
  let requestCounter = 0;
  function generateId() {
    return 'req-' + Date.now().toString(36) + '-' + (++requestCounter).toString(36);
  }

  // Safe postMessage wrapper
  function send(type, payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type,
          payload,
          timestamp: Date.now(),
          source: 'podex-devtools'
        }, '*');
      }
    } catch (e) {
      // Silently fail if postMessage is blocked
    }
  }

  // Safely stringify values for console capture
  function safeStringify(value, seen = new WeakSet()) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const type = typeof value;

    if (type === 'string') return value.substring(0, LIMITS.MAX_CONSOLE_ARG_SIZE);
    if (type === 'number' || type === 'boolean') return String(value);
    if (type === 'function') return '[Function: ' + (value.name || 'anonymous') + ']';
    if (type === 'symbol') return value.toString();

    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack
      });
    }

    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();

    // Handle DOM nodes
    if (value instanceof Node) {
      if (value instanceof Element) {
        return '<' + value.tagName.toLowerCase() +
               (value.id ? ' id="' + value.id + '"' : '') +
               (value.className ? ' class="' + value.className + '"' : '') + '>';
      }
      return '[Node: ' + value.nodeName + ']';
    }

    // Handle circular references
    if (type === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);

      try {
        const str = JSON.stringify(value, (key, val) => {
          if (typeof val === 'function') return '[Function]';
          if (val instanceof Error) return { name: val.name, message: val.message };
          return val;
        }, 2);
        return str ? str.substring(0, LIMITS.MAX_CONSOLE_ARG_SIZE) : '[Object]';
      } catch (e) {
        return '[Object: ' + Object.prototype.toString.call(value) + ']';
      }
    }

    return String(value).substring(0, LIMITS.MAX_CONSOLE_ARG_SIZE);
  }

  // ==================== CONSOLE CAPTURE ====================

  const originalConsole = {};
  const consoleMethods = ['log', 'warn', 'error', 'info', 'debug'];

  consoleMethods.forEach(function(method) {
    originalConsole[method] = console[method];
    console[method] = function() {
      // Capture arguments
      const args = Array.prototype.slice.call(arguments);
      const serializedArgs = args.map(function(arg) {
        return {
          type: typeof arg,
          value: safeStringify(arg)
        };
      });

      // Send to parent
      send(MSG.CONSOLE, {
        level: method,
        args: serializedArgs,
        url: window.location.href
      });

      // Call original console method
      return originalConsole[method].apply(console, arguments);
    };
  });

  // ==================== FETCH INTERCEPTION ====================

  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const requestId = generateId();
    const url = typeof input === 'string' ? input : (input.url || String(input));
    const method = (init && init.method) || 'GET';
    const startTime = performance.now();

    // Capture request
    var requestBody = null;
    if (init && init.body) {
      try {
        requestBody = typeof init.body === 'string'
          ? init.body.substring(0, LIMITS.MAX_BODY_SIZE)
          : '[Binary/FormData]';
      } catch (e) {
        requestBody = '[Unable to read body]';
      }
    }

    send(MSG.NETWORK_REQUEST, {
      id: requestId,
      url: url,
      method: method.toUpperCase(),
      headers: init && init.headers ? Object.fromEntries(
        init.headers instanceof Headers
          ? init.headers.entries()
          : Object.entries(init.headers)
      ) : {},
      body: requestBody,
      type: 'fetch'
    });

    // Execute fetch and capture response
    return originalFetch.apply(this, arguments)
      .then(function(response) {
        const duration = performance.now() - startTime;

        // Clone response to read body without consuming
        var responseBody = null;
        response.clone().text().then(function(text) {
          responseBody = text.substring(0, LIMITS.MAX_BODY_SIZE);

          send(MSG.NETWORK_RESPONSE, {
            id: requestId,
            url: url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
            duration: Math.round(duration),
            size: text.length
          });
        }).catch(function() {
          send(MSG.NETWORK_RESPONSE, {
            id: requestId,
            url: url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: null,
            duration: Math.round(duration),
            size: 0
          });
        });

        return response;
      })
      .catch(function(error) {
        send(MSG.NETWORK_RESPONSE, {
          id: requestId,
          url: url,
          error: error.message || 'Network error',
          duration: Math.round(performance.now() - startTime),
          status: 0
        });
        throw error;
      });
  };

  // ==================== XMLHttpRequest INTERCEPTION ====================

  var XHRProto = XMLHttpRequest.prototype;
  var originalOpen = XHRProto.open;
  var originalSend = XHRProto.send;
  var originalSetRequestHeader = XHRProto.setRequestHeader;

  XHRProto.open = function(method, url) {
    this._podexDevTools = {
      id: generateId(),
      method: (method || 'GET').toUpperCase(),
      url: url,
      headers: {},
      startTime: 0
    };
    return originalOpen.apply(this, arguments);
  };

  XHRProto.setRequestHeader = function(name, value) {
    if (this._podexDevTools) {
      this._podexDevTools.headers[name] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XHRProto.send = function(body) {
    var xhr = this;
    var info = xhr._podexDevTools;

    if (info) {
      info.startTime = performance.now();

      // Capture request body
      var requestBody = null;
      if (body) {
        try {
          requestBody = typeof body === 'string'
            ? body.substring(0, LIMITS.MAX_BODY_SIZE)
            : '[Binary/FormData]';
        } catch (e) {
          requestBody = '[Unable to read body]';
        }
      }

      send(MSG.NETWORK_REQUEST, {
        id: info.id,
        url: info.url,
        method: info.method,
        headers: info.headers,
        body: requestBody,
        type: 'xhr'
      });

      // Listen for completion
      xhr.addEventListener('loadend', function() {
        var duration = performance.now() - info.startTime;
        var responseHeaders = {};

        try {
          var headerStr = xhr.getAllResponseHeaders();
          if (headerStr) {
            headerStr.split('\\r\\n').forEach(function(line) {
              var parts = line.split(': ');
              if (parts.length === 2) {
                responseHeaders[parts[0].toLowerCase()] = parts[1];
              }
            });
          }
        } catch (e) {}

        var responseBody = null;
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBody = xhr.responseText.substring(0, LIMITS.MAX_BODY_SIZE);
          } else {
            responseBody = '[Binary response]';
          }
        } catch (e) {}

        send(MSG.NETWORK_RESPONSE, {
          id: info.id,
          url: info.url,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: responseHeaders,
          body: responseBody,
          duration: Math.round(duration),
          size: (responseBody || '').length
        });
      });
    }

    return originalSend.apply(this, arguments);
  };

  // ==================== ERROR HANDLING ====================

  window.addEventListener('error', function(event) {
    send(MSG.ERROR, {
      type: 'js_error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error ? event.error.stack : null
    });
  });

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    send(MSG.ERROR, {
      type: 'unhandled_rejection',
      message: reason ? (reason.message || String(reason)) : 'Unknown rejection',
      stack: reason && reason.stack ? reason.stack : null
    });
  });

  // ==================== NAVIGATION TRACKING ====================

  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  history.pushState = function() {
    var result = originalPushState.apply(this, arguments);
    send(MSG.NAVIGATE, {
      url: window.location.href,
      type: 'pushState',
      title: document.title
    });
    return result;
  };

  history.replaceState = function() {
    var result = originalReplaceState.apply(this, arguments);
    send(MSG.NAVIGATE, {
      url: window.location.href,
      type: 'replaceState',
      title: document.title
    });
    return result;
  };

  window.addEventListener('popstate', function() {
    send(MSG.NAVIGATE, {
      url: window.location.href,
      type: 'popstate',
      title: document.title
    });
  });

  window.addEventListener('hashchange', function() {
    send(MSG.NAVIGATE, {
      url: window.location.href,
      type: 'hashchange',
      title: document.title
    });
  });

  // ==================== DOM SNAPSHOT ====================

  function getNodeInfo(node, depth) {
    if (depth === undefined) depth = 0;
    if (depth > LIMITS.MAX_DOM_DEPTH || !node) return null;

    // Text node
    if (node.nodeType === 3) {
      var text = node.textContent.trim();
      if (text) {
        return { text: text.substring(0, 200) };
      }
      return null;
    }

    // Element node
    if (node.nodeType !== 1) return null;

    var info = {
      tagName: node.tagName.toLowerCase(),
      id: node.id || undefined,
      className: node.className || undefined,
      attributes: {}
    };

    // Capture key attributes
    var attrs = node.attributes;
    for (var i = 0; i < Math.min(attrs.length, 20); i++) {
      var attr = attrs[i];
      if (attr.name !== 'class' && attr.name !== 'id') {
        info.attributes[attr.name] = attr.value.substring(0, 100);
      }
    }
    if (Object.keys(info.attributes).length === 0) {
      delete info.attributes;
    }

    // Process children
    var children = [];
    var childNodes = node.childNodes;
    for (var j = 0; j < Math.min(childNodes.length, LIMITS.MAX_CHILDREN); j++) {
      var childInfo = getNodeInfo(childNodes[j], depth + 1);
      if (childInfo) {
        children.push(childInfo);
      }
    }
    if (children.length > 0) {
      info.children = children;
    }

    return info;
  }

  // ==================== PARENT COMMANDS ====================

  window.addEventListener('message', function(event) {
    // Only accept messages from parent
    if (event.source !== window.parent) return;

    var data = event.data;
    if (!data || data.type !== 'devtools:command') return;

    var command = data.command;
    var payload = data.payload;

    switch (command) {
      case 'getDOMSnapshot':
        send(MSG.DOM_SNAPSHOT, getNodeInfo(document.documentElement, 0));
        break;

      case 'navigate':
        if (payload && payload.url) {
          window.location.href = payload.url;
        }
        break;

      case 'reload':
        window.location.reload();
        break;

      case 'getHTML':
        send('devtools:html', {
          html: document.documentElement.outerHTML.substring(0, 50000)
        });
        break;

      case 'executeScript':
        // Only allow in development - evaluate script and return result
        if (payload && payload.script) {
          try {
            var result = eval(payload.script);
            send('devtools:eval:result', {
              success: true,
              result: safeStringify(result)
            });
          } catch (e) {
            send('devtools:eval:result', {
              success: false,
              error: e.message
            });
          }
        }
        break;
    }
  });

  // ==================== INITIALIZATION ====================

  // Signal ready state when DOM is loaded
  function signalReady() {
    send(MSG.READY, {
      url: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', signalReady);
  } else {
    signalReady();
  }

  // Also signal on full load
  window.addEventListener('load', function() {
    send(MSG.DOM_READY, {
      url: window.location.href,
      title: document.title
    });
  });
})();
</script>
"""


def should_inject_script(content_type: str | None) -> bool:
    """Check if content type is HTML and should have script injected.

    Args:
        content_type: The Content-Type header value from the response.

    Returns:
        True if the content is HTML and should have the DevTools script injected.
    """
    if not content_type:
        return False
    content_type_lower = content_type.lower()
    return "text/html" in content_type_lower or "application/xhtml" in content_type_lower


def inject_devtools_script(html_content: bytes, content_type: str | None) -> bytes:  # noqa: PLR0911
    """Inject DevTools bridge script into HTML content.

    The script is injected at the beginning of the <head> tag, or after the
    <html> tag if no <head> is found. If neither is found, the script is
    prepended to the content.

    Args:
        html_content: The raw HTML content as bytes.
        content_type: The Content-Type header value from the response.

    Returns:
        The HTML content with the DevTools script injected, as bytes.
        Returns the original content unchanged if not HTML or already injected.
    """
    if not should_inject_script(content_type):
        return html_content

    # Try to decode as UTF-8
    try:
        html_str = html_content.decode("utf-8")
    except UnicodeDecodeError:
        # Try with latin-1 as fallback
        try:
            html_str = html_content.decode("latin-1")
        except UnicodeDecodeError:
            # Can't decode, return unchanged
            return html_content

    # Check if already injected
    if "data-podex-devtools" in html_str:
        return html_content

    # Try to inject after <head> tag
    head_pattern = re.compile(r"(<head[^>]*>)", re.IGNORECASE)
    match = head_pattern.search(html_str)
    if match:
        insert_pos = match.end()
        modified = html_str[:insert_pos] + DEVTOOLS_BRIDGE_SCRIPT + html_str[insert_pos:]
        return modified.encode("utf-8")

    # Fallback: inject after <html> tag with a new <head>
    html_pattern = re.compile(r"(<html[^>]*>)", re.IGNORECASE)
    match = html_pattern.search(html_str)
    if match:
        insert_pos = match.end()
        modified = (
            html_str[:insert_pos]
            + "<head>"
            + DEVTOOLS_BRIDGE_SCRIPT
            + "</head>"
            + html_str[insert_pos:]
        )
        return modified.encode("utf-8")

    # Last resort: check for <!DOCTYPE and inject after it
    doctype_pattern = re.compile(r"(<!DOCTYPE[^>]*>)", re.IGNORECASE)
    match = doctype_pattern.search(html_str)
    if match:
        insert_pos = match.end()
        modified = (
            html_str[:insert_pos]
            + "<html><head>"
            + DEVTOOLS_BRIDGE_SCRIPT
            + "</head>"
            + html_str[insert_pos:]
        )
        return modified.encode("utf-8")

    # No recognizable HTML structure, prepend the script
    modified = DEVTOOLS_BRIDGE_SCRIPT + html_str
    return modified.encode("utf-8")
