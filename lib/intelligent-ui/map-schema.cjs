'use strict';
const { z } = require('zod/v4');
const place = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(120),
  lat: z.number().finite().min(-85).max(85), lng: z.number().finite().min(-180).max(180),
  detail: z.string().max(1600).optional(), image: z.string().max(2048).optional(), credit: z.string().max(200).optional()
});
const route = z.object({
  id: z.string().min(1).max(80), label: z.string().max(120),
  coordinates: z.array(z.tuple([z.number().finite().min(-85).max(85), z.number().finite().min(-180).max(180)])).min(2).max(2000)
});
const mapProps = z.object({name:z.string().min(1).max(80), places:z.array(place).min(1).max(100), routes:z.array(route).max(20)});
module.exports={mapProps};
