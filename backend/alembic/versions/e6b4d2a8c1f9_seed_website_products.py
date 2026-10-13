"""Product Management: seed the finished products published on premnathrail.com (2026-10-13).

Source: docs/product-data/premnathrail-website-products.xlsx — 14 products,
their specifications, 14 applications and the product↔application links,
collected from https://www.premnathrail.com/products/.

Insert-only and idempotent: a product or application whose code already
exists is left untouched (its specs too), so anything already entered by
hand wins. HSN code and warranty are not published on the website and stay
blank — fill them in Product Management.

Revision ID: e6b4d2a8c1f9
Revises: f3a8c1d5e7b2
"""
from alembic import op
import sqlalchemy as sa

revision = "e6b4d2a8c1f9"
down_revision = "f3a8c1d5e7b2"
branch_labels = None
depends_on = None

PRODUCTS = [{'code': 'PRT-CAM-01',
  'name': 'CAM Injection Vehicle',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'active',
  'short_description': 'Three-car cement asphalt mortar production and injection system for cushioning beneath track '
                       'slabs.',
  'description': 'Set of 3 vehicles: liquid, mixer and fine particle vehicle.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/cam-injection-vehicle/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RFC-01',
  'name': 'Rail Feeder Car',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'active',
  'short_description': 'Rail Laying Vehicle that feeds continuous welded rail up to 200 m long, for 60 kg/m rail, at '
                       'up to 30 m/min.',
  'description': 'Brochure name: Rail Laying Vehicle (Rail Feeder Car). Documented for 1,435 mm gauge only.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/rail-feeder-car/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RTH-01',
  'name': 'Rail Threader',
  'product_type': 'vehicle',
  'model_number': 'PEW-RT-15-5',
  'status': 'active',
  'short_description': 'Lifts, moves and places auxiliary railway track with 5 t capacity and an infinitely variable '
                       'gauge of 1,200-3,350 mm.',
  'description': 'Site calls it a rail-bound vehicle. 2 units supplied to KEC International in 2021. Confirm type: '
                 'vehicle or machine.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/rail-threader/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-MTP-01',
  'name': 'Mini Tamper',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'development',
  'short_description': 'Compact rail-bound tamper for sleeper tamping and minor geometry correction in switches, '
                       'crossings and plain track.',
  'description': 'UNDER DEVELOPMENT. Figures are preliminary and subject to confirmation. Site page URL is /tamper/.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/tamper/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-TSL-01',
  'name': 'Track Slab / Sleeper Laying Vehicle',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'active',
  'short_description': 'Train of one tow car and five freight cars that transports and lays five track slabs per '
                       'train.',
  'description': 'Set: 1 tow car + 5 freight cars.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/track-slab-sleeper-laying-vehicle/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-AUG',
  'name': 'RRV with Mobile Crane & Auger Drill',
  'product_type': 'vehicle',
  'model_number': '4F4R2GB-32FT',
  'status': 'active',
  'short_description': 'Multipurpose road-rail vehicle with crane, auger drill, mast grabber, lifting hook and work '
                       'platform.',
  'description': "Site menu name: Augering. Also covers the 'Mast & Beam Erection' page (an application of this "
                 'vehicle).\n'
                 '\n'
                 'Website: https://www.premnathrail.com/augering/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-FBW',
  'name': 'Flash-Butt Welding RRV',
  'product_type': 'vehicle',
  'model_number': '4F4R2GB-32FT',
  'status': 'active',
  'short_description': 'Road-rail platform for transporting a mobile welding plant for continuous rail welding.',
  'description': 'Welding plant supply scope is agreed per project (plant not part of the vehicle spec).\n'
                 '\n'
                 'Website: https://www.premnathrail.com/flash-butt-welding/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-CRN',
  'name': 'Mobile Crane RRV',
  'product_type': 'vehicle',
  'model_number': '2F2R2DD-MAX',
  'status': 'active',
  'short_description': '20 tonne, 360 degree full-slew pick-and-carry crane converted for the track.',
  'description': 'Site tag: Extended configuration.\n\nWebsite: https://www.premnathrail.com/mobile-crane-rrv/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-OHE',
  'name': 'RRV for Overhead Electrification (Extended)',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'active',
  'short_description': 'Multifunctional road-rail vehicle with scissor platform, motorised pantograph, cable drum '
                       'holder and crane with auger and mast clamp.',
  'description': 'Site tag: Extended configuration. Model number not published.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/over-head-electrification-ohe/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-SHN',
  'name': 'Diesel Shunting RRV',
  'product_type': 'vehicle',
  'model_number': '2F2R2FDD-18FT',
  'status': 'active',
  'short_description': 'Diesel road-rail vehicle for towing and shunting wagons and locomotives, stated towing '
                       'capacity 300-2,600 tonnes.',
  'description': 'A battery-electric shunting variant is under development (see PRT-RRV-SHN-BE).\n'
                 '\n'
                 'Website: https://www.premnathrail.com/shunting/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-SHN-BE',
  'name': 'Battery-Electric Shunting RRV',
  'product_type': 'vehicle',
  'model_number': None,
  'status': 'development',
  'short_description': 'Battery-electric shunting variant for depots and enclosed areas where diesel emissions are a '
                       'constraint.',
  'description': 'UNDER DEVELOPMENT. No specifications published; register-interest only.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/shunting/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-INS',
  'name': 'Track Inspection Vehicle',
  'product_type': 'vehicle',
  'model_number': '2F2R2GB-16FT',
  'status': 'active',
  'short_description': 'Road-rail inspection platform with four cameras, individual monitors and an air-conditioned '
                       'cabin for eight.',
  'description': 'Enabled for attachment of AI-based track inspection systems.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/track-inspection-car/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-RRV-MIX',
  'name': 'Concrete Mixer RRV (Transit Mixer)',
  'product_type': 'vehicle',
  'model_number': '4F4R2GB-32FT',
  'status': 'active',
  'short_description': 'Road-rail vehicle with a mixer of up to 7 cubic metres and guiding flutes for on-track '
                       'concrete pouring.',
  'description': 'Used for mast foundations and grouting.\n\nWebsite: https://www.premnathrail.com/transit-mixer/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None},
 {'code': 'PRT-GRD-01',
  'name': 'Gradall Road-Rail Excavator',
  'product_type': 'machine',
  'model_number': None,
  'status': 'active',
  'short_description': 'Telescopic-boom road-rail excavator for ditching, ballast work, sleeper handling and '
                       'vegetation management.',
  'description': 'DEALER PRODUCT: Premnath Rail is the authorised dealer in India, not the manufacturer. Ratings '
                 'depend on the Gradall model chosen; no fixed spec published.\n'
                 '\n'
                 'Website: https://www.premnathrail.com/gradall-road-rail-excavator/',
  'hsn_code': None,
  'uom': 'Nos',
  'warranty_months': None}]

APPLICATIONS = [{'code': 'CWR-FEED',
  'name': 'Continuous welded rail feeding',
  'description': 'Feeding continuous welded rails in the track-laying direction.'},
 {'code': 'AUX-TRACK',
  'name': 'Auxiliary track placement',
  'description': 'Lifting, moving and placing auxiliary railway track at the required gauge.'},
 {'code': 'SLAB-LAY',
  'name': 'Track slab transport and laying',
  'description': 'Transport and placement of track slabs for ballastless track.'},
 {'code': 'CAM-INJ',
  'name': 'CAM production and injection',
  'description': 'Cement asphalt mortar production and injection for cushioning beneath track slabs.'},
 {'code': 'TAMPING',
  'name': 'Sleeper tamping and minor geometry correction',
  'description': 'Tamping sleepers in switches, crossings and plain track.'},
 {'code': 'AUGER',
  'name': 'Auger drilling for foundations',
  'description': 'Auger drilling of mast and signal foundations from the track.'},
 {'code': 'MAST-BEAM',
  'name': 'Mast and beam erection',
  'description': 'Lifting, positioning and erecting OHE masts and portal beams.'},
 {'code': 'LIFT-HANDLE',
  'name': 'Heavy lifting and material handling',
  'description': 'Lifting and material movement on railway corridors.'},
 {'code': 'OHE',
  'name': 'Overhead electrification work',
  'description': 'OHE work using a scissor platform, motorised pantograph and cable drum holder.'},
 {'code': 'RAIL-WELD',
  'name': 'Rail welding plant transport',
  'description': 'Transport of a mobile welding plant for continuous rail welding.'},
 {'code': 'SHUNT',
  'name': 'Wagon and locomotive shunting',
  'description': 'Towing and shunting of wagons, locomotives and other rail-bound vehicles.'},
 {'code': 'TRACK-INSP',
  'name': 'Track inspection',
  'description': 'Railway track inspection, including AI-based inspection systems.'},
 {'code': 'CONC-MIX',
  'name': 'Concrete mixing and pouring',
  'description': 'On-track concrete mixing and pouring for mast foundations and grouting.'},
 {'code': 'EXCAVATE',
  'name': 'Ditching, ballast and sleeper work',
  'description': 'Ditching/drainage, ballast work, sleeper handling and vegetation management.'}]

# (product code, sort order, parameter, value, unit)
SPECIFICATIONS = [('PRT-CAM-01', 1, 'Vehicle class', 'Rail-bound vehicle', None),
 ('PRT-CAM-01', 2, 'Composition', 'Liquid vehicle + mixer vehicle + fine particle vehicle', None),
 ('PRT-CAM-01', 3, 'Liquid vehicle weight', '38,500', 'kg'),
 ('PRT-CAM-01', 4, 'Emulsion capacity', '18.3', 'm3'),
 ('PRT-CAM-01', 5, 'Water capacity', '3.7', 'm3'),
 ('PRT-CAM-01', 6, 'Mixer vehicle weight', '21,530', 'kg'),
 ('PRT-CAM-01', 7, 'Mixer tank count', '2', 'Nos'),
 ('PRT-CAM-01', 8, 'Capacity per mixer tank', '0.6-1.2', 'm3'),
 ('PRT-CAM-01', 9, 'Onboard generator', '90', 'kVA'),
 ('PRT-CAM-01', 10, 'Fine particle vehicle weight', '48,946', 'kg'),
 ('PRT-CAM-01', 11, 'Sand capacity', '15.5', 'm3'),
 ('PRT-CAM-01', 12, 'Cement capacity', '13.7', 'm3'),
 ('PRT-RFC-01', 1, 'Vehicle class', 'Rail-bound vehicle', None),
 ('PRT-RFC-01', 2, 'Maximum rail length', 'Up to 200', 'm'),
 ('PRT-RFC-01', 3, 'Rail feed speed', 'Up to 30', 'm/min'),
 ('PRT-RFC-01', 4, 'Rail feed capacity', '60', 'kg/m'),
 ('PRT-RFC-01', 5, 'Rail draw speed', 'Up to 10', 'm/min'),
 ('PRT-RFC-01', 6, 'Weight', '8,000', 'kg'),
 ('PRT-RFC-01', 7, 'Length', 'Max 7,000', 'mm'),
 ('PRT-RFC-01', 8, 'Width', 'Max 3,100', 'mm'),
 ('PRT-RFC-01', 9, 'Height', 'Max 3,600', 'mm'),
 ('PRT-RFC-01', 10, 'Gauge', '1,435', 'mm'),
 ('PRT-RFC-01', 11, 'Wheel diameter', 'Min 380', 'mm'),
 ('PRT-RTH-01', 1, 'Vehicle class', 'Rail-bound vehicle', None),
 ('PRT-RTH-01', 2, 'Lifting capacity', '5,000 (5 tonnes)', 'kg'),
 ('PRT-RTH-01', 3, 'Gross weight', '2,850', 'kg'),
 ('PRT-RTH-01', 4, 'Engine power', '15', 'HP'),
 ('PRT-RTH-01', 5, 'Fuel options', 'Diesel or petrol', None),
 ('PRT-RTH-01', 6, 'Maximum travel speed', '5', 'km/h'),
 ('PRT-RTH-01', 7, 'Operating gauge', '1,200-3,350, infinitely variable', 'mm'),
 ('PRT-MTP-01', 1, 'Vehicle class', 'Rail-bound vehicle', None),
 ('PRT-MTP-01', 2, 'Development status', 'Under development', None),
 ('PRT-MTP-01', 3, 'Engine', 'Water-cooled diesel engine with genset', None),
 ('PRT-MTP-01', 4, 'Tamping system', 'Asynchronous, electronically controlled', None),
 ('PRT-MTP-01', 5, 'Tamping frequency', 'Approx. 35', 'Hz'),
 ('PRT-MTP-01', 6, 'Weight', 'Approx. 3,500', 'kg'),
 ('PRT-MTP-01', 7, 'Lifting', 'Up to 100', 'mm'),
 ('PRT-MTP-01', 8, 'Tamping-unit power', 'Hydraulic', None),
 ('PRT-TSL-01', 1, 'Vehicle class', 'Rail-bound vehicle', None),
 ('PRT-TSL-01', 2, 'Composition', '1 tow car + 5 freight cars', None),
 ('PRT-TSL-01', 3, 'Loading quantity', '5 slabs per train', None),
 ('PRT-TSL-01', 4, 'Applicable track-centre distance', '2,960', 'mm'),
 ('PRT-TSL-01', 5, 'Tow car weight', '9,500', 'kg'),
 ('PRT-TSL-01', 6, 'Tow car travel speed', 'Up to 5', 'km/h'),
 ('PRT-TSL-01', 7, 'Freight car weight', '4,200', 'kg'),
 ('PRT-TSL-01', 8, 'Chain blocks per freight car', '2', 'Nos'),
 ('PRT-TSL-01', 9, 'Lifting capacity per chain block', '2.8', 'tonne'),
 ('PRT-RRV-AUG', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-AUG', 2, 'Model', '4F4R2GB-32FT', None),
 ('PRT-RRV-AUG', 3, 'Gross vehicle weight', '19,000-35,000', 'kg'),
 ('PRT-RRV-AUG', 4, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-AUG', 5, 'Rail braking', 'Disc brakes', None),
 ('PRT-RRV-AUG', 6, 'Rail speed', '15-45, forward and reverse', 'km/h'),
 ('PRT-RRV-AUG', 7, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-AUG', 8, 'Drill diameter', '900-1,200', 'mm'),
 ('PRT-RRV-AUG', 9, 'Drill depth', '4,200', 'mm'),
 ('PRT-RRV-AUG', 10, 'Crane', 'Multipurpose crane', None),
 ('PRT-RRV-AUG', 11, 'Attachments', 'Auger drill, mast grabber, lifting hook, work platform', None),
 ('PRT-RRV-AUG', 12, 'Stabilisation', 'Outriggers', None),
 ('PRT-RRV-FBW', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-FBW', 2, 'Model', '4F4R2GB-32FT', None),
 ('PRT-RRV-FBW', 3, 'Gross vehicle weight', '35,000', 'kg'),
 ('PRT-RRV-FBW', 4, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-FBW', 5, 'Rail braking', 'Disc brakes', None),
 ('PRT-RRV-FBW', 6, 'Rail speed', '45, forward and reverse', 'km/h'),
 ('PRT-RRV-FBW', 7, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-FBW', 8, 'Stabilisation', 'Outriggers and stabilisers', None),
 ('PRT-RRV-FBW', 9, 'Additional control', 'Remote control for rear-side operation', None),
 ('PRT-RRV-CRN', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-CRN', 2, 'Model', '2F2R2DD-MAX', None),
 ('PRT-RRV-CRN', 3, 'Gross vehicle weight', '20,000', 'kg'),
 ('PRT-RRV-CRN', 4, 'Lifting capacity', 'Up to 20,000', 'kg'),
 ('PRT-RRV-CRN', 5, 'Maximum lifting height', '19.2', 'm'),
 ('PRT-RRV-CRN', 6, 'Slew', '360 full slew', 'deg'),
 ('PRT-RRV-CRN', 7, 'Engine power', '101', 'HP'),
 ('PRT-RRV-CRN', 8, 'Road drive', '4WD', None),
 ('PRT-RRV-CRN', 9, 'Rail wheel arrangement', 'Custom pivot axle', None),
 ('PRT-RRV-CRN', 10, 'Rail wheel diameter', '730', 'mm'),
 ('PRT-RRV-CRN', 11, 'Rail speed', '20, forward and reverse', 'km/h'),
 ('PRT-RRV-CRN', 12, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-CRN', 13, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-CRN', 14, 'Attachments', 'Lifting hook; mast/material clamp', None),
 ('PRT-RRV-OHE', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-OHE', 2, 'Motor', 'High-torque piston', None),
 ('PRT-RRV-OHE', 3, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-OHE', 4, 'Brakes', 'All-wheel pneumatic disc', None),
 ('PRT-RRV-OHE', 5, 'Top rail speed', '60', 'km/h'),
 ('PRT-RRV-OHE', 6, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-OHE', 7, 'Rail wheel material', 'Steel', None),
 ('PRT-RRV-OHE', 8, 'Rail wheel diameter', 'Up to 730', 'mm'),
 ('PRT-RRV-OHE', 9, 'Platform movement', 'Scissor', None),
 ('PRT-RRV-OHE', 10, 'Platform dimensions', '3,500 x 2,400 (customisable)', 'mm'),
 ('PRT-RRV-OHE', 11, 'Platform open height', '6,000 from rail', 'mm'),
 ('PRT-RRV-OHE', 12, 'Automated side extension reach', '2,750', 'mm'),
 ('PRT-RRV-OHE', 13, 'Pantograph', 'Motorised', None),
 ('PRT-RRV-OHE', 14, 'Pantograph travel', '2,000', 'mm'),
 ('PRT-RRV-OHE', 15, 'Cable drum diameter', 'Up to 3,000', 'mm'),
 ('PRT-RRV-OHE', 16, 'Cable drum holder brake', 'Mechanical', None),
 ('PRT-RRV-OHE', 17, 'Crane equipment', 'Crane with auger drill and mast clamp', None),
 ('PRT-RRV-OHE', 18, 'Drill diameter', '900-1,200', 'mm'),
 ('PRT-RRV-OHE', 19, 'Drill depth', '4,200', 'mm'),
 ('PRT-RRV-OHE', 20, 'Remote control', 'Wired and wireless', None),
 ('PRT-RRV-OHE', 21, 'Tracking', 'Live GPS tracking', None),
 ('PRT-RRV-OHE', 22, 'Cabin display', 'Touch screen', None),
 ('PRT-RRV-OHE', 23, 'Rear visibility', 'Rear-view camera', None),
 ('PRT-RRV-OHE', 24, 'Wagon coupling', 'Coupling arrangement for towing wagons', None),
 ('PRT-RRV-SHN', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-SHN', 2, 'Model', '2F2R2FDD-18FT', None),
 ('PRT-RRV-SHN', 3, 'Power type', 'Diesel operated', None),
 ('PRT-RRV-SHN', 4, 'Towing capacity range', '300-2,600', 'tonne'),
 ('PRT-RRV-SHN', 5, 'Rail transmission', 'Friction', None),
 ('PRT-RRV-SHN', 6, 'Forward gears', '9', 'Nos'),
 ('PRT-RRV-SHN', 7, 'Reverse gears', '9', 'Nos'),
 ('PRT-RRV-SHN', 8, 'Unloaded rail speed', '40, forward and reverse', 'km/h'),
 ('PRT-RRV-SHN', 9, 'Loaded rail speed', '20, forward and reverse', 'km/h'),
 ('PRT-RRV-SHN', 10, 'Operating modes', 'Separate rail mode and shunt mode', None),
 ('PRT-RRV-SHN', 11, 'Rail braking', 'Disc brakes', None),
 ('PRT-RRV-SHN', 12, 'Railway braking air supply', 'Air compressor', None),
 ('PRT-RRV-SHN', 13, 'Supply to towed wagons', 'Electrical and pneumatic', None),
 ('PRT-RRV-SHN', 14, 'Towed-wagon braking', 'Proportional braking', None),
 ('PRT-RRV-SHN', 15, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-INS', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-INS', 2, 'Model', '2F2R2GB-16FT', None),
 ('PRT-RRV-INS', 3, 'Gross vehicle weight', '12,500', 'kg'),
 ('PRT-RRV-INS', 4, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-INS', 5, 'Rail braking', 'Disc brakes', None),
 ('PRT-RRV-INS', 6, 'Forward rail speed', '45', 'km/h'),
 ('PRT-RRV-INS', 7, 'Reverse rail speed', '15', 'km/h'),
 ('PRT-RRV-INS', 8, 'Maximum axle load, empty', '4.25', 'tonne'),
 ('PRT-RRV-INS', 9, 'Maximum axle load, loaded', '5.86', 'tonne'),
 ('PRT-RRV-INS', 10, 'Wheel diameter, new', '730', 'mm'),
 ('PRT-RRV-INS', 11, 'Wheel diameter, worn', '710', 'mm'),
 ('PRT-RRV-INS', 12, 'Cameras', '4', 'Nos'),
 ('PRT-RRV-INS', 13, 'Displays', 'Individual monitors for track viewing', None),
 ('PRT-RRV-INS', 14, 'Cabin', 'Air-conditioned, seats 8', None),
 ('PRT-RRV-INS', 15, 'AI inspection provision', 'Enabled for attachment of AI-based track inspection systems', None),
 ('PRT-RRV-INS', 16, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-MIX', 1, 'Vehicle class', 'Road-rail vehicle', None),
 ('PRT-RRV-MIX', 2, 'Model', '4F4R2GB-32FT', None),
 ('PRT-RRV-MIX', 3, 'Gross vehicle weight', '35,000', 'kg'),
 ('PRT-RRV-MIX', 4, 'Rail transmission', 'Hydrostatic', None),
 ('PRT-RRV-MIX', 5, 'Rail braking', 'Disc brakes', None),
 ('PRT-RRV-MIX', 6, 'Rail speed', '45, forward and reverse', 'km/h'),
 ('PRT-RRV-MIX', 7, 'Available track gauges', '1,000 / 1,435 / 1,676', 'mm'),
 ('PRT-RRV-MIX', 8, 'Concrete mixer capacity', 'Up to 7', 'm3'),
 ('PRT-RRV-MIX', 9, 'Pouring equipment', 'Guiding flutes', None),
 ('PRT-GRD-01', 1, 'Boom', 'Telescopic with integrated tilt', None),
 ('PRT-GRD-01', 2, 'Premnath Rail role', 'Authorised dealer in India', None),
 ('PRT-GRD-01', 3, 'Rapid Drive', 'Option availability to be confirmed per model', None)]

# (product code, application code)
LINKS = [('PRT-CAM-01', 'CAM-INJ'),
 ('PRT-RFC-01', 'CWR-FEED'),
 ('PRT-RTH-01', 'AUX-TRACK'),
 ('PRT-MTP-01', 'TAMPING'),
 ('PRT-TSL-01', 'SLAB-LAY'),
 ('PRT-RRV-AUG', 'AUGER'),
 ('PRT-RRV-AUG', 'MAST-BEAM'),
 ('PRT-RRV-AUG', 'LIFT-HANDLE'),
 ('PRT-RRV-FBW', 'RAIL-WELD'),
 ('PRT-RRV-CRN', 'LIFT-HANDLE'),
 ('PRT-RRV-CRN', 'MAST-BEAM'),
 ('PRT-RRV-OHE', 'OHE'),
 ('PRT-RRV-OHE', 'AUGER'),
 ('PRT-RRV-OHE', 'MAST-BEAM'),
 ('PRT-RRV-SHN', 'SHUNT'),
 ('PRT-RRV-SHN-BE', 'SHUNT'),
 ('PRT-RRV-INS', 'TRACK-INSP'),
 ('PRT-RRV-MIX', 'CONC-MIX'),
 ('PRT-GRD-01', 'EXCAVATE'),
 ('PRT-GRD-01', 'LIFT-HANDLE')]


def upgrade() -> None:
    conn = op.get_bind()
    app_ids = {}
    for a in APPLICATIONS:
        row = conn.execute(sa.text("SELECT id FROM product_applications WHERE upper(code) = :c"), {"c": a["code"]}).first()
        if row is None:
            row = conn.execute(sa.text(
                "INSERT INTO product_applications (code, name, description, is_active) "
                "VALUES (:code, :name, :description, true) RETURNING id"
            ), a).first()
        app_ids[a["code"]] = row[0]

    new_ids = {}
    for p in PRODUCTS:
        if conn.execute(sa.text("SELECT 1 FROM products WHERE upper(code) = :c"), {"c": p["code"]}).first():
            continue
        new_ids[p["code"]] = conn.execute(sa.text(
            "INSERT INTO products (code, name, product_type, model_number, status, short_description, description, "
            "hsn_code, uom, warranty_months) VALUES (:code, :name, :product_type, :model_number, :status, "
            ":short_description, :description, :hsn_code, :uom, :warranty_months) RETURNING id"
        ), p).scalar_one()

    for code, sort_order, parameter, value, unit in SPECIFICATIONS:
        if code in new_ids:
            conn.execute(sa.text(
                "INSERT INTO product_specifications (product_id, sort_order, parameter, value, unit) "
                "VALUES (:p, :s, :param, :v, :u)"
            ), {"p": new_ids[code], "s": sort_order, "param": parameter, "v": value, "u": unit})

    for code, app_code in LINKS:
        if code in new_ids:
            conn.execute(sa.text(
                "INSERT INTO product_application_links (product_id, application_id) VALUES (:p, :a) ON CONFLICT DO NOTHING"
            ), {"p": new_ids[code], "a": app_ids[app_code]})


def downgrade() -> None:
    # Master data — once seeded, products may be quoted, edited or linked to
    # store items, so a schema downgrade never deletes them.
    pass
