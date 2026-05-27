-- Seed 12 CDMX corridor definitions (6 roads × AM + PM direction)
-- Coordinates are verified entry/exit points for each corridor.
-- AM direction = toward city centre. PM = reversed.

INSERT INTO corridors (slug, name, road, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end) VALUES

-- Viaducto Miguel Alemán
('viaducto-am',
 'Viaducto Oriente (Mañana)',
 'Viaducto Miguel Alemán',
 19.3983, -99.1918,   -- origin: Constituyentes end
 19.4147, -99.0790,   -- dest: Eje 3 Oriente / Aeropuerto
 '07:00', '10:00'),

('viaducto-pm',
 'Viaducto Poniente (Tarde)',
 'Viaducto Miguel Alemán',
 19.4147, -99.0790,   -- origin: Eje 3 Oriente / Aeropuerto
 19.3983, -99.1918,   -- dest: Constituyentes end
 '17:00', '20:00'),

-- Circuito Bicentenario (Circuito Interior)
('bicentenario-am',
 'Bicentenario Sur (Mañana)',
 'Circuito Bicentenario',
 19.4487, -99.1374,   -- origin: Guerrero / Norte arc
 19.3749, -99.1836,   -- dest: Insurgentes Sur / Mixcoac arc
 '07:00', '10:00'),

('bicentenario-pm',
 'Bicentenario Norte (Tarde)',
 'Circuito Bicentenario',
 19.3749, -99.1836,   -- origin: Insurgentes Sur / Mixcoac arc
 19.4487, -99.1374,   -- dest: Guerrero / Norte arc
 '17:00', '20:00'),

-- Periférico Norte
('periferico-norte-am',
 'Periférico Norte → Centro (Mañana)',
 'Periférico Norte',
 19.4726, -99.1758,   -- origin: Cuatro Caminos / Naucalpan
 19.4153, -99.2054,   -- dest: Constituyentes crossing
 '07:00', '10:00'),

('periferico-norte-pm',
 'Periférico Norte → Cuatro Caminos (Tarde)',
 'Periférico Norte',
 19.4153, -99.2054,   -- origin: Constituyentes crossing
 19.4726, -99.1758,   -- dest: Cuatro Caminos / Naucalpan
 '17:00', '20:00'),

-- Periférico Sur
('periferico-sur-am',
 'Periférico Sur → Centro (Mañana)',
 'Periférico Sur',
 19.3030, -99.1507,   -- origin: Estadio Azteca / Tlalpan
 19.3601, -99.1733,   -- dest: Insurgentes Sur crossing
 '07:00', '10:00'),

('periferico-sur-pm',
 'Periférico Sur → Azteca (Tarde)',
 'Periférico Sur',
 19.3601, -99.1733,   -- origin: Insurgentes Sur crossing
 19.3030, -99.1507,   -- dest: Estadio Azteca / Tlalpan
 '17:00', '20:00'),

-- Paseo de la Reforma
('reforma-am',
 'Reforma → Alameda (Mañana)',
 'Paseo de la Reforma',
 19.4001, -99.1892,   -- origin: Observatorio / Chapultepec
 19.4354, -99.1452,   -- dest: Alameda Central / Bellas Artes
 '07:00', '10:00'),

('reforma-pm',
 'Reforma → Observatorio (Tarde)',
 'Paseo de la Reforma',
 19.4354, -99.1452,   -- origin: Alameda Central / Bellas Artes
 19.4001, -99.1892,   -- dest: Observatorio / Chapultepec
 '17:00', '20:00'),

-- Avenida de las Palmas
('palmas-am',
 'Palmas → Reforma (Mañana)',
 'Av. de las Palmas',
 19.4218, -99.2519,   -- origin: Bosques de las Lomas
 19.4199, -99.2138,   -- dest: Fuente de Petróleos
 '07:00', '10:00'),

('palmas-pm',
 'Palmas → Bosques (Tarde)',
 'Av. de las Palmas',
 19.4199, -99.2138,   -- origin: Fuente de Petróleos
 19.4218, -99.2519,   -- dest: Bosques de las Lomas
 '17:00', '20:00');
