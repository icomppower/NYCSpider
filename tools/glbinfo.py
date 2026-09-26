import json, struct, sys
for path in sys.argv[1:]:
    b = open(path, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    print(path, 'nodes', len(j['nodes']), 'meshes', [m['name'] for m in j.get('meshes', [])])
    print(' anims', [(a['name'], len(a['channels'])) for a in j.get('animations', [])])
    print(' materials', [m['name'] for m in j.get('materials', [])])
    print(' extras', [n.get('extras') for n in j['nodes'] if n.get('extras')][:3])
