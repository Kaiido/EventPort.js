// FF young implementation doesn't support `import` inside of Worklets
//import "../EventPort.js";

let x = 0;
let y = 0;
let w = 0;
let h = 0;

// white-noise-processor.js
class TestProcessor extends AudioWorkletProcessor {
  constructor() {

    super();
    this.port.onmessage = ( evt ) => {

      w = evt.data.innerWidth;
      h = evt.data.innerHeight;
      const event_port = evt.eventPorts && evt.eventPorts[ 0 ];
      if( event_port ) {
        event_port.addEventListener( 'custom-resize', (evt) => {
          w = evt.innerWidth;
          h = evt.innerHeight;  
        } );
        event_port.addEventListener( 'mousemove', (evt) => {
          x = evt.clientX / w;
          y = evt.clientY / h;
        } );
      }

    };
  }
  process (inputs, outputs, parameters) {

    outputs.forEach( (output, is_right ) => {
    
      const dist = is_right ? x : 1 - x;
      const pan = Math.min( dist * 2, 1 );

      output.forEach( (channel) => {

        for (let i = 0; i < channel.length; i++) {
          const volume = (y * pan);
          const noise  = (Math.random() * 2) - 1
          channel[ i ] = noise * volume;
        }

      } );

    } );

    return true;
  
  }
}

registerProcessor( "test-processor" , TestProcessor );