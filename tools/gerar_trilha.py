"""Gera trilha-data.js a partir do XML do documento "Trilha de estudo: Concurso ANPD".

Uso: python3 tools/gerar_trilha.py caminho/trilha.xml > trilha-data.js
Os ids dos itens derivam do texto (hash curto), então marcações sobrevivem a mudanças de ordem.
Se o texto de um item mudar, ele ganha id novo e volta a ficar pendente.
"""
import re, html, json, sys, hashlib, unicodedata

def txt(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()

def take(tag, s, i):
    depth = 0
    for m in re.compile(r'<(/?)%s\b[^>]*?(/?)>' % tag).finditer(s, i):
        if m.group(1) == '' and m.group(2) == '': depth += 1
        elif m.group(1) == '/': depth -= 1
        if depth == 0: return m.end()
    return len(s)

def parse(x):
    body = re.sub(r"^<doc[^>]*>|</doc>$", "", x)
    out, i = [], 0
    while True:
        m = re.compile(r'<(\w+)').search(body, i)
        if not m: break
        tag = m.group(1); end = take(tag, body, m.start()); chunk = body[m.start():end]; i = end
        if tag == 'paragraph':
            h = re.match(r"<paragraph[^>]*heading='(\d)'", chunk)
            out.append({'t': 'h' + h.group(1) if h else 'p', 'text': txt(chunk)})
        elif tag == 'list':
            out.append({'t': 'list', 'items': [txt(li) for li in re.findall(r'<listItem[^>]*>(.*?)</listItem>', chunk, flags=re.S)]})
        elif tag == 'table':
            out.append({'t': 'table', 'rows': [[txt(c) for c in re.findall(r'<cell[^>]*>(.*?)</cell>', r, flags=re.S)]
                                               for r in re.findall(r'<row[^>]*>(.*?)</row>', chunk, flags=re.S)]})
    return out

def hid(prefix, s):
    n = unicodedata.normalize('NFKD', s.lower())
    n = re.sub(r'[^a-z0-9]', '', n)[:80]
    return prefix + '-' + hashlib.sha1(n.encode()).hexdigest()[:8]

ABREV = ('art', 'arts', 'nº', 'inc', 'res', 'dec', 'n', 'cf', 'p', 'ed')

def split_label(s):
    """Separa rótulo curto e detalhe sem cortar em abreviações como "art." ou "nº"."""
    m = re.match(r'^(.{3,90}?\))\.\s+(.*)$', s)
    if m: return m.group(1), m.group(2)
    c = s.find(': ')
    if 20 <= c <= 100: return s[:c], s[c + 2:]
    if len(s) <= 140: return s, ''
    for m in re.finditer(r'\.\s', s):
        if m.start() < 40: continue
        w = re.findall(r'(\w+)$', s[:m.start()])
        if w and w[0].lower() in ABREV: continue
        return s[:m.start()], s[m.end():]
    return s[:137] + '...', s

def iso(dm):
    d, m = dm.split('/')
    y = 2026 if int(m) >= 11 else 2027
    return f'{y}-{int(m):02d}-{int(d):02d}'

def sections_of(blocks):
    secs, cur = {}, None
    for b in blocks:
        if b['t'] == 'h2':
            cur = b['text']; secs[cur] = []
        elif cur: secs[cur].append(b)
    return secs

def find(secs, prefix):
    for k, v in secs.items():
        if k.startswith(prefix): return k, v
    raise SystemExit('seção não encontrada: ' + prefix)

def main():
    blocks = parse(open(sys.argv[1], encoding='utf-8').read())
    secs = sections_of(blocks)
    S = []

    # Roteiro do dia
    k, bl = find(secs, 'Roteiro do dia')
    groups, week = [], None
    for b in bl:
        if b['t'] == 'p' and b['text'].startswith('Semana'):
            week = {'title': b['text'], 'items': []}; groups.append(week)
        elif b['t'] == 'table' and week:
            head = [re.sub(r'\s*\(.*\)', '', h) for h in b['rows'][0]]
            for r in b['rows'][1:]:
                dm = re.search(r'(\d{2}/\d{2})', r[0])
                if not dm: continue
                for col, cell in zip(head[1:], r[1:]):
                    if not cell or cell.startswith('(sem bloco)'): continue
                    blk = 'Sábado' if r[0].startswith('Sáb') else col
                    week['items'].append({'id': hid('rot', r[0] + blk + cell), 'date': iso(dm.group(1)), 'block': blk, 'label': cell})
    S.append({'key': 'roteiro', 'title': k, 'kind': 'roteiro', 'groups': groups})

    # Módulos
    for pref, key in [('Módulo 1', 'mod1'), ('Módulo 2', 'mod2'), ('Módulo 3', 'mod3')]:
        k, bl = find(secs, pref)
        groups, g = [], None
        for b in bl:
            if b['t'] == 'p' and len(b['text']) < 60 and not b['text'].endswith('.'):
                g = {'title': b['text'], 'items': []}; groups.append(g)
            elif b['t'] == 'list':
                if g is None:
                    g = {'title': '', 'items': []}; groups.append(g)
                for it in b['items']:
                    lab, det = split_label(it)
                    g['items'].append({'id': hid(key, it), 'label': lab, 'detail': det})
        S.append({'key': key, 'title': k, 'kind': 'lista', 'groups': groups})

    # Jurisprudência + itens que faltavam
    k, bl = find(secs, 'Jurisprudência')
    tab = next(b for b in bl if b['t'] == 'table')
    items = [{'id': hid('jur', r[0] + r[1]), 'label': f'{r[0]} ({r[1]})', 'detail': f'{r[2]} Fundamento: {r[3]}'} for r in tab['rows'][1:]]
    groups = [{'title': 'Casos', 'items': items}]
    lst = next((b for b in bl if b['t'] == 'list'), None)
    if lst:
        groups.append({'title': 'Também faltavam na trilha', 'items': [dict(zip(('label', 'detail'), split_label(it)), id=hid('falt', it)) for it in lst['items']]})
    S.append({'key': 'juris', 'title': k, 'kind': 'lista', 'groups': groups})

    # Processo sancionador
    k, bl = find(secs, 'Processo sancionador')
    lst = next(b for b in bl if b['t'] == 'list')
    S.append({'key': 'sanc', 'title': k, 'kind': 'lista', 'groups': [{'title': '', 'items': [dict(zip(('label', 'detail'), split_label(it)), id=hid('sanc', it)) for it in lst['items']]}]})

    # Teses
    k, bl = find(secs, 'Caderno de prazos')
    lst = next(b for b in bl if b['t'] == 'list')
    S.append({'key': 'teses', 'title': 'Dez teses (Caderno de prazos e teses)', 'kind': 'lista', 'groups': [{'title': 'Marque quando souber explicar com o dispositivo', 'items': [{'id': hid('tese', it), 'label': it, 'detail': ''} for it in lst['items']]}]})

    # Provas anteriores
    k, bl = find(secs, 'Provas anteriores')
    tab = next(b for b in bl if b['t'] == 'table')
    S.append({'key': 'provas', 'title': k, 'kind': 'lista', 'groups': [{'title': 'Meia prova cronometrada', 'items': [{'id': hid('prova', r[0] + r[1]), 'label': f'{r[0]} {r[1]} ({r[2]})', 'detail': r[3]} for r in tab['rows'][1:]]}]})

    # Discursivas
    k, bl = find(secs, 'Discursiva semanal')
    tab = next(b for b in bl if b['t'] == 'table')
    items = []
    for r in tab['rows'][1:]:
        items.append({'id': hid('disc', r[0] + r[2]), 'date': iso(r[1]), 'label': f'Semana {r[0]} ({r[1]}): {r[2]}', 'detail': 'Base: ' + r[3], 'nota': True})
    S.append({'key': 'disc', 'title': k, 'kind': 'discursiva', 'groups': [{'title': '', 'items': items}]})

    # Cursos
    k, bl = find(secs, 'Cursos gratuitos')
    tab = next(b for b in bl if b['t'] == 'table')
    S.append({'key': 'cursos', 'title': k, 'kind': 'lista', 'groups': [{'title': '', 'items': [{'id': hid('curso', r[0]), 'label': f'{r[0]} ({r[1]})', 'detail': r[2]} for r in tab['rows'][1:]]}]})

    # Checklist do edital (fora do progresso de conteúdo)
    k, bl = find(secs, 'Quando o edital sair')
    lst = next(b for b in bl if b['t'] == 'list')
    S.append({'key': 'edital', 'title': k, 'kind': 'checklist', 'excluded': True, 'groups': [{'title': '', 'items': [dict(zip(('label', 'detail'), split_label(it)), id=hid('edital', it)) for it in lst['items']]}]})

    ids = [i['id'] for s in S for g in s['groups'] for i in g['items']]
    assert len(ids) == len(set(ids)), 'ids duplicados'
    print('// Gerado por tools/gerar_trilha.py a partir da trilha de estudo (documento no Claude). Não edite à mão.')
    print('const TRILHA_GERADA_EM = ' + json.dumps(__import__('datetime').date.today().isoformat()) + ';')
    print('const TRILHA_URL = "https://claude.ai/artifact/Lzk3paFejEQVHp3YSwaFhB";')
    print('const TRILHA = ' + json.dumps(S, ensure_ascii=False, indent=1) + ';')

main()
