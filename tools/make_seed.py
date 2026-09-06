#!/usr/bin/env python3
"""Buat seed-data.json dari file master SABANA:
- `Price List Sabana Sharing Mitra.pdf` -> daftar bahan baku (kode, nama, satuan, isi, harga)
- `HPP Reguler.xlsx` -> produk/menu + harga jual + draf resep (BOM)

Hasil: `src/data/seed-data.json` — data IMPOR AWAL (bukan hardcode), selalu
bisa diedit di aplikasi. Jalankan: python tools/make_seed.py
"""
import json
import os
import re
import zipfile
import zlib
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "HPP Reguler.xlsx")
PDF = os.path.join(ROOT, "Price List Sabana Sharing Mitra.pdf")
OUT = os.path.join(ROOT, "src", "data", "seed-data.json")

# --------------------------------------------------------------------------
# 1) PDF -> daftar bahan
# --------------------------------------------------------------------------

def pdf_text_tokens(path: str):
    data = open(path, "rb").read()
    tokens = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        try:
            dec = zlib.decompress(m.group(1))
        except Exception:
            continue
        for p in re.findall(rb"\((?:[^()\\]|\\.)*\)\s*Tj|\[(?:[^\[\]]*)\]\s*TJ", dec):
            strs = re.findall(rb"\((?:[^()\\]|\\.)*\)", p)
            line = ""
            for st in strs:
                inner = st[1:-1]
                inner = inner.replace(rb"\(", b"(").replace(rb"\)", b")").replace(rb"\\", b"\\")
                line += inner.decode("latin-1")
            if line.strip():
                tokens.append(line.strip())
    return tokens


def _num(s: str):
    s = s.replace(",", "").replace("Rp", "").replace(" ", "")
    try:
        return int(float(s))
    except Exception:
        return None


def kategori_bahan(kode: str, nama: str) -> str:
    n = nama.upper()
    if kode.startswith("100"):
        if "BERAS" in n:
            return "Nasi & Beras"
        return "Ayam"
    if "TEPUNG" in n:
        return "Tepung & Bumbu"
    if "MINYAK" in n:
        return "Minyak"
    if any(s in n for s in ("SAUS", "SAMBAL", "MAYONAISE")):
        return "Saus & Sambal"
    if any(s in n for s in ("KEMASAN", "BOX", "KERTAS", "CUP", "PLASTIK", "PAPER", "SENDOK", "SARUNG", "KARDUS", "RICE BOX")):
        return "Kemasan & Lainnya"
    if any(s in n for s in ("FRUIT TEA", "SOSRO", "AIR ", "CONCENTRATE")):
        return "Minuman"
    if "KENTANG" in n:
        return "Kentang & Gorengan"
    if kode.startswith("200"):
        return "Aneka Bahan"
    return "Lainnya"


def parse_first_number(s):
    m = re.search(r"(\d+(?:[.,]\d+)?)", s or "")
    if not m:
        return 1
    return float(m.group(1).replace(",", "."))


def parse_bahan_from_pdf(path: str):
    tokens = pdf_text_tokens(path)
    items = []
    i = 0
    n = len(tokens)
    code_re = re.compile(r"^\d{6}$")
    while i < n:
        t = tokens[i]
        if t == "SABANA PRICE LIST":
            i += 1
            continue
        if code_re.match(t) and t.startswith(("1", "2")):
            kode = t
            # ambil nama (maks 3 token ke depan sampai ketemu token yang terlihat seperti satuan/harga)
            j = i + 1
            nama = tokens[j] if j < n else ""
            j += 1
            # satuan & isi: token berikut yang bukan angka harga & bukan 'Rp'
            def lookahead(idx):
                vals = []
                while idx < n and len(vals) < 4:
                    tk = tokens[idx]
                    if code_re.match(tk) or tk == "SABANA PRICE LIST":
                        break
                    vals.append(tk)
                    idx += 1
                return vals, idx
            rest, next_i = lookahead(j)
            satuan = ""
            isi = ""
            harga = None
            # urutan umum: [nama, satuan, isi?, harga, 'Rp'] — cari 'Rp' terakhir
            rp_pos = None
            for k, v in enumerate(rest):
                if v == "Rp":
                    rp_pos = k
            if rp_pos is not None and rp_pos > 0:
                h = _num(rest[rp_pos - 1])
                harga = h if h is not None else None
                seg = rest[: rp_pos - 1]
                if seg:
                    nama = seg[0] if nama in (seg[0], "") else (nama or seg[0])
                # satuan = token pertama yang bukan angka; isi sisanya
                if len(seg) >= 1:
                    satuan = seg[0]
                if len(seg) >= 2:
                    isi = " ".join(seg[1:])
            else:
                satuan = ""
            is_ayam9 = "9 POTONG" in (isi or "").upper()
            items.append({
                "kodePusat": kode,
                "nama": nama,
                "kategori": kategori_bahan(kode, nama),
                "satuanBeli": satuan,
                "isiLabel": isi,
                "satuanDasar": infer_satuan_dasar(isi or satuan, nama),
                "hargaBeliDefault": harga,
                "jumlahDasarPerBeli": parse_first_number(isi),
                "isAyam": is_ayam9,
                "komposisiAyam": {"dada": 3, "pahaAtas": 2, "pahaBawah": 2, "sayap": 2} if is_ayam9 else None,
            })
            i = next_i
        else:
            i += 1
    # dedupe per kode (pertahankan pertama)
    seen = set()
    uniq = []
    for it in items:
        if it["kodePusat"] in seen:
            continue
        seen.add(it["kodePusat"])
        uniq.append(it)
    return uniq


def infer_satuan_dasar(label: str, nama: str) -> str:
    u = label.upper() + " " + nama.upper()
    if "LITER" in u or "LTR" in u or "ML" in u:
        return "ml" if "ML" in u and "LITER" not in u and "LTR" not in u else "liter"
    if "KILO" in u or "KG" in u or "GRAM" in u or "GR" in u:
        if "GRAM" in u or ("GR" in u and "KG" not in u):
            return "gram"
        return "kg"
    if "POTONG" in u:
        return "potong"
    if any(x in u for x in ("PCS", "LEMBAR", "IKAT", "PACK", "SACHET", "BOTOL", "GELAS", "DUS", "CUP", "PAK")):
        return "pcs"
    return "pcs"


# --------------------------------------------------------------------------
# 2) XLSX -> produk/menu + draf resep
# --------------------------------------------------------------------------

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _q(t):
    return f"{{{M}}}{t}"


def _col_idx(ref):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    c = 0
    for ch in m.group(1):
        c = c * 26 + (ord(ch) - 64)
    return c - 1, int(m.group(2))


def read_xlsx_sheets(path: str):
    z = zipfile.ZipFile(path)
    shared = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall(_q("si")):
        shared.append("".join(t.text or "" for t in si.iter(_q("t"))))

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.get("Id"): r.get("Target") for r in rels}
    sheetfiles = []
    for s in wb.iter(_q("sheet")):
        rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        sheetfiles.append((s.get("name"), "xl/" + relmap[rid].lstrip("/")))

    sheets = {}
    for name, f in sheetfiles:
        root = ET.fromstring(z.read(f))
        rows = {}
        width = 0
        for row in root.iter(_q("row")):
            r = int(row.get("r"))
            cells = {}
            for c in row.findall(_q("c")):
                ci, _ = _col_idx(c.get("r"))
                t = c.get("t")
                v = c.find(_q("v"))
                isv = c.find(_q("is"))
                val = ""
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr" and isv is not None:
                    val = "".join(x.text or "" for x in isv.iter(_q("t")))
                elif v is not None:
                    val = v.text or ""
                cells[ci] = val
                width = max(width, ci)
            rows[r] = cells
        grid = []
        for r in sorted(rows):
            cells = rows[r]
            grid.append([(cells.get(ci) or "").strip() for ci in range(width + 1)])
        sheets[name] = grid
    return sheets


PRODUK_META = {
    "PENDAPATAN": None,  # diolah khusus (potongan ayam)
    "AYAM REGULER": None,
    "AYAM SBP": None,
    "NASI": ("Nasi", "Nasi"),
    "CR": ("Chicken Roll", "Aneka Goreng"),
    "BKS": ("Bakso", "Aneka Goreng"),
    "CS": ("Chicken Strip", "Aneka Goreng"),
    "CHICKEN BUN": ("Chicken Bun", "Paket"),
    "KULIT": ("Kulit Crispy", "Aneka Goreng"),
    "BURGER": ("Burger", "Paket"),
    "KENTANG": ("Kentang Goreng", "Aneka Goreng"),
    "GEPREK": ("Sambal Geprek", "Sambal"),
    "BULDAK": ("Saus Buldak", "Sambal"),
    "MENTAI": ("Saus Mentai", "Sambal"),
    "SADAS": ("Saus Sadas", "Sambal"),
    "SAMBAL HITAM": ("Sambal Hitam", "Sambal"),
    "SAMBAL IJO": ("Sambal Ijo", "Sambal"),
    "KATSU": ("Chicken Katsu", "Aneka Goreng"),
    "RICE BOWL 650ML": ("Rice Bowl 650ml", "Paket"),
    "RICE BOWL 500ML": ("Rice Bowl 500ml", "Paket"),
    "SIMULASI": None,
}


def cells_of(grid, row):
    return grid[row]


def find_price(grid, variants):
    """cari 'Pendapatan ...' terdekat dengan nilai angka."""
    for ri, row in enumerate(grid):
        for ci, cell in enumerate(row):
            if any(v in str(cell).upper() for v in variants):
                # angka di sebelah kanan
                for cj in range(ci + 1, min(ci + 4, len(row))):
                    n = _num(row[cj])
                    if n is not None:
                        return n
    return None


def resep_draft_from_grid(grid):
    """Ambil baris-baris antara header INGREDIENTS dan baris Total Cost."""
    start = None
    for ri, row in enumerate(grid):
        joined = " ".join(row).upper()
        if "INGREDIENTS" in joined:
            start = ri + 1
            break
    if start is None:
        return []
    rows = []
    for ri in range(start, len(grid)):
        joined = " ".join(grid[ri]).upper()
        if "TOTAL COST" in joined:
            break
        cells = [c for c in grid[ri] if c]
        if not cells:
            continue
        if cells[0].isdigit():
            cells = cells[1:]  # buang kolom NO
        # nama bahan = token pertama yang bukan angka murni
        rows.append({
            "bahan": cells[0] if cells else "",
            "satuan": cells[1] if len(cells) > 1 else "",
            "biaya": _num(cells[2]) if len(cells) > 2 else None,
            "total": _num(cells[3]) if len(cells) > 3 else None,
            "keterangan": cells[4] if len(cells) > 4 else "",
        })
    return rows


def main():
    bahan_list = parse_bahan_from_pdf(PDF)
    sheets = read_xlsx_sheets(XLSX)

    produk = []
    seen_produk = set()

    # potongan ayam dari sheet PENDAPATAN — harga = angka tepat SETELAH nama bagian
    for row in sheets["PENDAPATAN"]:
        for bagian, nama, kat in [
            ("DADA", "Ayam Dada Goreng", "Ayam Goreng"),
            ("PAHA ATAS", "Ayam Paha Atas Goreng", "Ayam Goreng"),
            ("PAHA BAWAH", "Ayam Paha Bawah Goreng", "Ayam Goreng"),
            ("SAYAP", "Ayam Sayap Goreng", "Ayam Goreng"),
        ]:
            try:
                idx = row.index(bagian)
            except ValueError:
                continue
            h = None
            for cell in row[idx + 1:]:
                n = _num(cell)
                if n is not None:
                    h = n
                    break
            if h and nama not in seen_produk:
                seen_produk.add(nama)
                produk.append({
                    "nama": nama, "kategori": kat, "hargaJual": h,
                    "tipeStok": "produksi", "aktif": True, "sheet": "PENDAPATAN",
                    "resepDraft": [],
                })

    for sheet, meta in PRODUK_META.items():
        if meta is None or sheet not in sheets:
            continue
        grid = sheets[sheet]
        base_nama, kat = meta
        harga = find_price(grid, ["PENDAPATAN"])
        nama = base_nama
        if sheet.startswith("RICE BOWL"):
            # beberapa varian dalam satu sheet (Geprek/BBQ/Katsu)
            for blok, bloknama in [("SAMBAL GEPREK", base_nama + " Sambal Geprek"),
                                   ("BBQ", base_nama + " BBQ"),
                                   ("KATSU", base_nama + " Katsu")]:
                sub = [grid[ri] for ri in range(len(grid)) if blok in " ".join(grid[ri]).upper()]
                if not sub:
                    continue
                h = find_price(sub, ["PENDAPATAN"]) or harga
                if bloknama not in seen_produk:
                    seen_produk.add(bloknama)
                    produk.append({
                        "nama": bloknama, "kategori": kat, "hargaJual": h or 0,
                        "tipeStok": "produksi", "aktif": False, "sheet": sheet,
                        "resepDraft": resep_draft_from_grid(sub),
                    })
            continue
        if nama in seen_produk:
            continue
        seen_produk.add(nama)
        aktif = sheet not in ("CHICKEN BUN", "BURGER", "BULDAK", "SADAS", "SAMBAL HITAM")
        produk.append({
            "nama": nama, "kategori": kat, "hargaJual": harga or 0,
            "tipeStok": "produksi", "aktif": aktif, "sheet": sheet,
            "resepDraft": resep_draft_from_grid(grid),
        })

    seed = {
        "version": 3,
        "dibuat": "tools/make_seed.py",
        "sumber": {"hpp": os.path.basename(XLSX), "priceList": os.path.basename(PDF)},
        "bahan": bahan_list,
        "produk": produk,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(bahan_list)} bahan, {len(produk)} produk -> {OUT}")


if __name__ == "__main__":
    main()
