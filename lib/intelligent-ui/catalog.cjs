'use strict';
// The official catalog owns general components, bindings and local expressions.
// Yan adds only its permission-controlled map adapter.
const { createLibrary, defineComponent } = require('@openuidev/lang-core');
const { openuiLibrary } = require('@openuidev/react-ui/genui-lib');
const { mapProps } = require('./map-schema.cjs');
function makeCatalog(MapView = () => null) {
  const Map = defineComponent({name:'Map', description:'Verified WGS84 places with selectable details and retained itinerary. Requires resources.map=true. Declare every photo. Reordering never calculates roads.', props:mapProps, component:MapView});
  return createLibrary({root:'Stack', components:[...Object.values(openuiLibrary.components), Map], functions:Object.values(openuiLibrary.functions || {})});
}
module.exports = { makeCatalog, mapProps };
