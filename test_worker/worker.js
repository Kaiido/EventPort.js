importScripts( "../EventPort.js" );

// get deeper
const sub_worker = new Worker( "sub-worker.js" );
sub_worker.onmessage = (evt) => postMessage( evt.data );
onmessage = (evt)  => {
  
  const { canvas, eventPort } = evt.data;
  sub_worker.postMessage( evt.data, [ canvas, eventPort ].filter( Boolean ) );

};