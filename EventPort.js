// EventPort.js by Kaiido
//
// loosely based on https://github.com/WICG/input-for-workers/pull/8
// Main API design by NavidZ after an original idea from smaug----
// Extends the EventTarget interface with a createEventPort() method returning a pseudo EventPort
// which can be transferred through different js contexts through the postMessage APIs
//
// Every context that should produce or receive such EventPorts needs to include this script.
//

(()=> { "use strict";

  // Only passive handlers are attached to the original targets
  const default_event_options_dict = {
    capture: false,
    passive: true
  };
  // We currently only support the 'once' option
  // on EventPort.[add|remove]EventListener
  const default_options_dict = {
    once: false,
  };
  // https://github.com/WICG/input-for-workers#stripping-dom-references-from-events
  const event_keys_to_remove = {
    "view": null,
    // "target": null, // t.b.d -> 'target' should probably be the mirror
    "currentTarget": null,
    "sourceElement": null,
    "composedPath": null
  };
  const event_noops_methods = [
    "dispatchEvent",
    "stopPropagation",
    "stopImmediatePropagation", 
    "preventDefault"
  ];

  // To be able to revive Ports in other contexts,
  // we need to have something letting these contexts know they have to search for something
  // Unfortunately, there doesn't seem to be any way to mark a MessagePort in any 
  // meaningful way cross-context wise.
  // And we must have this distinction to allow real MessagePorts to still be transferred.
  // We can't only rely on '.data' content (and for example wrap MessagePorts around some 
  // recognizable object shape), because we can transfer our EventPorts without it being
  // anywhere in the '.data'.
  // So we wrap the full '.data' content around an object using the following constant...
  const _UGLY_MAGIC_KEYWORD_ = "__event_ports_map__";

  // Each context holds its own storage
  const storage = new WeakMap();
    
  // This interface is used by the events fired on receiver side of the mirror
  class OpaqueEvent {
    constructor( sanitized, context ) {

      Object.assign( this, sanitized );
      event_noops_methods.forEach( key => this[ key ] = noop );
      this.target = context;

    }
  }
  
  // Transferrable part of the mirror (public)
  class EventPort {
    // The only argument of the constructor is the `outerPort` MessagePort
    // of a EventPortInternal (possibly the same object)
    constructor( outerPort ) {
      
      // We store ourselves our callbacks by type
      const eventSlots = {};
      storage.set( this, { outerPort, eventSlots } );

      // This will fire when the EventPortInternal transmits a new DOM event
      outerPort.onmessage = ( { data } ) => {
        const opaqueEvent = new OpaqueEvent( data, this );
        const slot = eventSlots[ data.type ];
        if( slot ) {
          const to_remove = [];
          slot.forEach( ({ callback, options }, index) => {
            try {
              callback.call( this, opaqueEvent );
            }
            catch( e ) {
              // we don't want to block our execution,
              // but still, we should notify the exception
              setTimeout( () => { throw e; } );
            }
            if( options.once ) {
              to_remove.push( index );
            }
          } );
          // remove 'once' events
          to_remove.reverse().forEach( index => slot.splice( index, 1 ) );
        }
      };
      
    }
    addEventListener( type, callback, options = default_options_dict ) {
      
      const { outerPort, eventSlots } = storage.get( this );
      
      let slot = eventSlots[ type ];
      if( !slot ) {
        slot = eventSlots[ type ] = [];
        // make the main thread attach only a single event,
        // we'll handle the multiple callbacks
        // and since we force { passive: true, capture: false }
        // they'll all get attached the same way there
        outerPort.postMessage( { type, action: "add" } );
      }
      // to store internally, and avoid duplicates (like EventTarget.addEventListener does)
      const new_item = {
          callback,
          options,
          options_as_string: stringifyEventInitOptions( options )
        };
      if( !getStoredItem( slot, new_item ) ) {
        slot.push( new_item );
      }

    }
    removeEventListener( type, callback, options = default_options_dict ) {
      
      const { outerPort, eventSlots } = storage.get( this );
      
      let slot = eventSlots[ type ];
      const options_as_string = stringifyEventInitOptions( options );

      const item = getStoredItem( slot, { callback, options, options_as_string } );
      const index = item && slot.indexOf( item );

      if( item ) {
        slot.splice( index, 1 );
      }
      if( slot && !slot.length ) {
        delete eventSlots[ type ];
        // Tell the main thread to remove the event handler
        // only when there is no callbacks of this type anymore
        outerPort.postMessage( { type, action: "remove" } );
      }

    }
  }

  // The part that stays in the original thread.
  // Responsible to communicate with the target
  // It creates and links to an EventPort accessible as @property '.public'
  class EventPortInternal {
    constructor( target ) {

      const channel = new MessageChannel();
      const outerPort = channel.port1;
      const innerPort = channel.port2;

      this.public = new EventPort( outerPort );
      
      // When a Receiver will either add or remove a new listener
      innerPort.onmessage = (evt) => {
        const { type, action } = evt.data;
        if( action === "add" ) {
          target.addEventListener( type, handleDOMEvent, default_event_options_dict );        
        }
        else if( action === "remove" ) {
          target.removeEventListener( type, handleDOMEvent, default_event_options_dict );        
        }
      };
      
      function handleDOMEvent( evt ) {
        innerPort.postMessage( sanitizeEvent( evt ) );
      }
      
    }
  }
  
  // We override EventTarget and add the 'createEventPort' method
  Object.defineProperty( EventTarget.prototype, "createEventPort", {
    value: createEventPort,
    configurable: true
  } );
  function createEventPort() {
    const internal = new EventPortInternal( this || globalThis );
    return internal.public;
  }
  
  // Spoof some constructors so we can handle their onmessage and postMessage
  if( typeof Worker === "function" ) {
    // In Safari, 'new Worker' doesn't return a 'Worker' instance...
    // We have to construct one to get its proto
    const url = URL.createObjectURL( new Blob( [ "" ], { type: "text/javascript" } ) );
    const test_worker = new Worker( url );
    const proto = Object.getPrototypeOf( test_worker );
    overridePostMessage( proto );
    test_worker.terminate();
    URL.revokeObjectURL( url );
  }

  if( typeof MessageChannel === "function" ) {
    MessageChannel = spoofMessageChannelConstructor();
  }
  if( typeof AudioWorkletProcessor === "function" ) {
    AudioWorkletProcessor = spoofAudioWorkletProcessorConstructor();
  }
  if( typeof MessagePort === "function" ) {
    overridePostMessage( MessagePort.prototype );
  }
  if( globalThis.postMessage ) {
    overridePostMessage( globalThis );
    globalThis.addEventListener( "message", retrievePassiveMirrors );
  }
  
  [
    [ 'HTMLIFrameElement', 'contentWindow' ],
    [ 'HTMLObjectElement', 'contentWindow' ]
  ].forEach( ( [ source, prop ] ) => {
    if( typeof globalThis[ source ] === "function" ) {
      overrideSpecialWindows( globalThis[ source ].prototype, prop );
    }
  } );

  if( globalThis.open ) {
    overrideOpenWindow( globalThis );
  }
  // 'Window.top' is non-configurable...
  [ 'parent', 'opener' ].forEach( (prop) => {

    if( prop in globalThis ) {
      try {
        overrideSpecialWindows( globalThis, prop );
      }
      catch( err ) {
        console.warn( err );
      }      
    }
    
  } );
  
  if( typeof MessageEvent === "function" ) {
    overrideSpecialWindows( MessageEvent.prototype, 'source' );
  }
  // else {
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1639793
  //}  

  function overrideSpecialWindows( proto, prop ) {

    const originalDesc = Object.getOwnPropertyDescriptor( proto, prop );
    
    if( originalDesc.get ) {
      Object.defineProperty( proto, prop, {
        get: function() {

          const win = originalDesc.get.call( this );

          if( win ) {
            overridePostMessage( win );
            overrideOpenWindow( win );
          }
          
          return win;

        },
        set: originalDesc.set || noop
      } );
    }
    
  }

  function overrideOpenWindow( win ) {

    try {

      const original = win.open;
      win.open = (...args) => {

        const popup = original.apply( this, args );
        if( popup ) {
          overridePostMessage( popup );
          overrideOpenWindow( win );
        }
        return popup;

      };
    }
    catch( err ) {
      // crossorigin...
    }  

  
  }

  function spoofWorkerConstructor( ) {

    class SpoofedClass extends Worker {
      constructor( ...args ) {
        super( ...args );
        this.addEventListener( "message", retrievePassiveMirrors );
      }
    }

    return SpoofedClass;
    
  }
  function spoofMessageChannelConstructor( ) {

    class SpoofedClass extends MessageChannel {
      constructor( ...args ) {
        super( ...args );
        this.port1.addEventListener( "message", retrievePassiveMirrors );
        this.port2.addEventListener( "message", retrievePassiveMirrors );
      }
    }

    return SpoofedClass;
    
  }
  function spoofAudioWorkletProcessorConstructor( ) {

    class SpoofedClass extends AudioWorkletProcessor {
      constructor( ...args ) {
        super( ...args );
        this.port.addEventListener( "message", retrievePassiveMirrors );
      }
    }

    return SpoofedClass;
    
  }
  
  // used in the Receiver side, to revive potential PassiveMirrors
  function retrievePassiveMirrors( evt ) {

    let { data, ports } = evt;
    // no PassiveMirrors being transferred
    if( !ports || !ports.length ) { return; }

    // This is the second and last safety check to be sure we really are handling
    // an event that contains PassiveMirrors.
    // It's unfortunately a bit fragile...
    const indices = data && data[  _UGLY_MAGIC_KEYWORD_ ];
    const referenced_objects = new Set(); // to handle cyclic references

    if( Array.isArray( indices ) ) { // only if 

      const eventPorts = [];
      ports = [ ...ports ];
      indices.reverse().forEach( (index) => {
        const port = ports[ index ];
        if( port ) {
          const mirror = new EventPort( port );
          searchAndReplacePortInData( "data", { data }, port, mirror );
          ports.splice( index, 1 ); // remove it from the ports[]
          eventPorts.push( mirror );
        }
      } );
      data = data.data;
      
      // This event should be stopped right now
      evt.stopImmediatePropagation();
      // We'll start a new one
      const fakeEventInit = Object.assign(
        {},
        evt,
        { data, ports }
      );
      const fakeEvent = new MessageEvent( "message", fakeEventInit );
      fakeEvent.eventPorts = eventPorts;
      this.dispatchEvent( fakeEvent );
      
    }
    
    function searchAndReplacePortInData( key, source, to_find, replacement ) {

      const value = source[ key ];
      if( value === to_find ) {
        source[ key ] = replacement;
      }
      else if( value && typeof value === "object" && !referenced_objects.has( value ) ) {
        referenced_objects.add( value );
        Object.keys( value ).forEach( key =>
          searchAndReplacePortInData( key, value, to_find, replacement )
        );
      }

    }
  }
  
  // used in the Emitter side, to extract the MessagePort from any PassiveMirrors
  // being transferred
  function overridePostMessage( source ) {

    const originalPostMessage = source.postMessage;

    const is_source_Window = globalThis.Window && (
        source instanceof Window ||
        // At least in Chromeand Safari, ProxyWindow does not inherit from Window
        // Chrome exposes a '[ Symbol.toStringTag ]', but Safari doesn't.
        Object.prototype.toString.call( source ) === "[object Window]"
        
      );

    if( !originalPostMessage ) { return; }

    try {
      Object.defineProperty( source, "postMessage", {
        value: is_source_Window ? overridenWindowPostMessage : overridenPostMessage
      } );
    }    
    catch( err ) {
      // crossorigin...
    }

    function overridenWindowPostMessage( ...args ) {

      const { data, transferables } = searchAndReplacePassiveMirrors( args[ 0 ], args[ 2 ] );
      originalPostMessage.call( this, data, args[ 1 ], transferables );

    }
    function overridenPostMessage( ...args ) {
    
      const { data, transferables } = searchAndReplacePassiveMirrors( args[ 0 ], args[ 1 ] );
      originalPostMessage.call( this, data, transferables );

    }

  }
  function searchAndReplacePassiveMirrors( data, transferables ) {

    // No transferrables, there can't be any EventPort
    if( !Array.isArray( transferables ) ) {
      return { data, transferables };
    }

    let index = -1;
    const indices = []; // used later on for revival
    const referenced_objects = new Set(); // to handle cyclic references

    transferables = transferables.map( ( value ) => {
      const mirror = tryToGetMirror( value );
      if( mirror ) {
        index ++;
        indices.push( index );
        return mirror.outerPort;
      }
      if( value instanceof MessagePort ) {
        index ++; // We'll search in MessageEvent.ports
      }
      return value;
    } );
  
    if( indices.length ) {
      searchAndReplaceMirrorsInData( "data", { data } );
      data = { // wrap so we can recognize at the receiver end
        [ _UGLY_MAGIC_KEYWORD_ ]: indices,
        data: data
      };
    }
    // TODO: Fix this nightmare...
    // ProxyWindow will get our wrapper twice:
    // once in top, and once in their own context
    // They won't be able to share the storage, thus each side needs to do its own job
    // But if one side finds our ugly magic keyword, it will try to unwrap it from its
    // own storage, resulting in no revival, and the disparition of the indices marker
    // for the second pass.
    // The only workaround I can think of right now is to double wrap in case we didn't
    // find any mirror but found a previous wrapper
    else if( data[ _UGLY_MAGIC_KEYWORD_ ] ) {
      data = { // double wrap
        [  _UGLY_MAGIC_KEYWORD_ ]: indices,
        data: data
      };      
    }
    return { data, transferables };
    
    function searchAndReplaceMirrorsInData( key, source ) {

      const value = source[ key ];
      const mirror = tryToGetMirror( value );
      if( mirror) {
        source[ key ] = mirror.outerPort;
      }
      else if( value && typeof value === "object" && !referenced_objects.has( value ) ) {
        referenced_objects.add( value );
        Object.keys( value ).forEach( key =>
          searchAndReplaceMirrorsInData( key, value )
        );
      }

    }

  }
  
  function tryToGetMirror( port ) {
  
    if( port instanceof EventPort && storage.has( port ) ) {
      return storage.get( port );
    }
  
  }

  // EventInitOptions need to be serialized in a deterministic way
  // so we can detect duplicates 
  function stringifyEventInitOptions( options ) {
    
    if( typeof options === "boolean" ) {
      options = { once: options };
    }
    try {
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(
            options
          ).sort( byKeyAlpha )
        )
      );
    } 
    catch( e ) {
      return JSON.stringify( default_options_dict );
    }
  
  }
  function byKeyAlpha( entry_a, entry_b ) {

    return entry_a[ 0 ].localeCompare( entry_b[ 0 ] );

  }
  
  // retrieves an event item in a slot based on its callback and its stringified options
  function getStoredItem( slot, { callback, options_as_string } ) {

    return Array.isArray( slot ) && slot.find( (obj) =>
      obj.callback === callback &&
        obj.options_as_string === options_as_string
    );

  }

  // Events can not be cloned as is, so we need to stripe out all non cloneable properties
  function sanitizeEvent( evt ) {
    
    const copy = {};
    // Most events only have .isTrusted as own property, so we use a for in loop to get all
    // otherwise JSON.stringify() would just ignore them
    for( let key in evt ) {
      // strip out some DOM references
      if( event_keys_to_remove.hasOwnProperty( key ) ) {
        copy[ key ] = event_keys_to_remove[ key ];
      }
      copy[ key ] = evt[ key ];      
    }
    
    const as_string = tryToStringify( copy );
    return JSON.parse( as_string );

    // over complicated recursive function to handle cross-origin access
    function tryToStringify() {

      const referenced_objects = new Set(); // to handle cyclic references
      // for cross-origin objects (e.g window.parent in a cross-origin iframe)
      // we save the previous key value so we can delete it if throwing
      let lastKey;  
      let nextVal = copy;
      let lastVal = copy;
      try {
        return JSON.stringify( copy, removeDOMRefsFunctionsAndCyclics );
      }
      catch( e ) {   
        delete lastVal[ lastKey ];
        return tryToStringify();
      }
      
      function removeDOMRefsFunctionsAndCyclics( key, value ) {

        lastVal = nextVal;
        lastKey = key;
        
        if( typeof value === "function" ) {
          return;
        }
        if( typeof value === "string" || typeof value === "number") {
          return value;
        }
        if( value && typeof value === "object" ) {
          if( globalThis.Node && value instanceof Node ) {
            return;
          }
          if( globalThis.Window && value instanceof Window ) {
            return;
          }
          if( referenced_objects.has( value ) ) {
            return "[cyclic]";
          }
          referenced_objects.add( value );
          nextVal = value;
          return value;
        }
        return value;
        
      }

    }
    
  }

  function noop() {}

})();