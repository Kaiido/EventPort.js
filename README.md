# EventPort.js #

## Experimental implementation of an EventPort interface ##

Loosely based on [this proposal][1] and particularly on [this PR][2] by @NavidZ

This script extends the [EventTarget][3] interface with a `createEventPort` method which returns a pseudo *EventPort* object.  
This *EventPort* object offers a mean to register passive event listeners on the original target from which it has been created. It can be transferred to other javascript contexts through the different [`postMessage`][4] APIs.  

It's main use case is to allow scripts in Workers that normally don't have access to the DOM to listen to DOM events, but one can obviously use it for other purposes too.  

## How to use ##

Each javascript context on which you want to use the *EventPort* must include this script.  
Once it's executed, you can simply create a new *EventPort* from any *EventTarget* by calling its `createEventPort()` method.

    const eventTarget = document.getElementById( 'target' );
    const eventPort = eventTarget.createEventPort();

Then you can pass this *EventPort* to an other javascript context by **transferring** it through the `postMessage()` method, just like [*MessagePorts*][5]:

    // Here 'data' can be any cloneable value, including an EventPort or an object
    // holding one, as long as it's also in the tranferables array.
    worker.postMessage( data, [ eventPort ] );
    
In target context, it will be available as the `.eventPorts` Array of the *MessageEvent*:

    // in worker.js
    addEventListener( 'message', (evt) => {
      const eventPort = evt.eventPorts[ 0 ];
      ...
    } );

Once the context has access to this *EventPort*, it can start listening to new *Events*:

     const handleClick = (evt) => { console.log( 'clicked' ); };
     eventPort.addEventListener( 'click', handleClick );
     
It is also possible to remove this listener:

     eventPort.removeEventListener( 'click', handleClick );
    
This listener will receive an *OpaqueEvent*, made from the original Event, on which [some properties have been stripped out][6] (the ones linked to the DOM), and all the methods have been disabled.

The only *option* that can be passed to the `addEventListener()` and `removeEventListener()` methods is `once`, auto-removing the event once it fired.  
The *EventPort* will only generate passive bubbling listeners.

### What *contexts* are supported? ###

This script currently supports normal document's Window, same-origin iframe's Window, same-origin `open`ed Window, Worker's global Scope and inner Workers, AudioWorklets.  

**Note that we currently don't support cross-origin contexts.** There is a [branch][7] dedicated to this work, but the current implementation is too unstable. Use it only where and if, you really need it.  

## Can I use this script on my website? ##

**Not before you do a lot of tests.**  
This project is really just a playground to better see how a future API could be shaped, it's not meant to be used in production, and hasn't been tested, at all.  

If you find bugs, or have any idea on how to improve this script feel free to open an issue or even PRs.  

## Browser support ##

Experimented only on latest Firefox, Chrome and Safari, no deep tests have been performed yet.    

[1]: https://github.com/WICG/input-for-workers
[2]: https://github.com/WICG/input-for-workers/pull/8 
[3]: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
[4]: https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
[5]: https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
[6]: https://github.com/WICG/input-for-workers#stripping-dom-references-from-events
[7]: https://github.com/Kaiido/EventPort.js/tree/cross-origin