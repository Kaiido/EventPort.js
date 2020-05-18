importScripts( "../EventPort.js" );

let ctx;
function handleMouseMove( evt ) {
  if( ctx ) {
    draw( evt.offsetX, evt.offsetY );
  }
  else {
    // so we can log for browsers without OffscreenCanvas
    [
      "target",
      "dispatchEvent",
      "stopPropagation",
      "stopImmediatePropagation", 
      "preventDefault"
    ].forEach( key => { delete evt[ key ]; } );
    postMessage( evt );

  }
}
function handleMouseClick( evt ) {
  
  postMessage( "removing listener" );
  this.removeEventListener( "mousemove", handleMouseMove );
  
}
function draw( x, y ) {

  const rad = 30;
  ctx.clearRect( 0, 0, ctx.canvas.width, ctx.canvas.height );
  ctx.beginPath();
  ctx.arc( x, y, rad, 0, Math.PI*2 );
  ctx.fill();

}

onmessage = (evt)  => {
  
  const { canvas, eventPort } = evt.data;
  eventPort.addEventListener( "mousemove", handleMouseMove );
  eventPort.addEventListener( "click", handleMouseClick, { once: true } );
  if( canvas ) {
    ctx = canvas.getContext( '2d' );
  }

};
