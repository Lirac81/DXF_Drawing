import json
import ezdxf
from pathlib import Path


# JSON読み込み
with open("drawing.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# DXFバージョン指定
doc = ezdxf.new("R2007", setup=True)

msp = doc.modelspace()

# 寸法スタイル
base = doc.dimstyles.get("EZDXF")
attrs = base.dxfattribs()

# テーブル管理用の属性は新しいDIMSTYLEには引き継がない
attrs.pop("handle", None)
attrs.pop("owner", None)
attrs.pop("name", None)

dimstyle = doc.dimstyles.new(
    "MECHANICAL",
    dxfattribs=attrs
)

# =========================
# 機械図面用の設定
# =========================

# 寸法値の倍率
dimstyle.dxf.dimlfac = 1.0

# 寸法文字高さ
dimstyle.dxf.dimtxt = 4.0

# 矢印サイズ
dimstyle.dxf.dimblk = "OPEN30"

# 矢印サイズ
dimstyle.dxf.dimasz = 3.0

# 小数点以下の桁数
dimstyle.dxf.dimdec = 3

# 寸法線と寸法補助線の間隔
dimstyle.dxf.dimgap = 1.0

# 寸法補助線の延長
dimstyle.dxf.dimexe = 1.0

# 寸法補助線の起点からのオフセット
dimstyle.dxf.dimexo = 1.0

# print("MECHANICAL DIMLFAC =", dimstyle.dxf.dimlfac)
# print("EZDXF DIMLFAC      =", doc.dimstyles.get("EZDXF").dxf.dimlfac)
print("MECHANICAL attrs    =", dimstyle.dxfattribs())

# --- 1. 図面全体のデフォルト変数（HEADER）を直接書き換える ---
# 図面単位：mm
doc.header["$INSUNITS"] = 4
doc.header["$DIMLFAC"] = 1.0  # 長さの計測倍率を 1 に固定
doc.header["$DIMTXT"] = 4.0  # 文字高さ：4.0
doc.header["$DIMASZ"] = 3.0  # 寸法線矢印サイズ：3.0
doc.header["$DIMGAP"] = 1.0  # 寸法線補助線と寸法の隙間：1.0
doc.header["$DIMEXO"] = 1.0  # 位置と寸法線補助線の隙間：1.0
# その他、必要に応じて $DIMASZ（矢印サイズ）なども指定可能


# レイヤー
for name, settings in data.get("layers", {}).items():
    doc.layers.add(
        name=name,
        color=settings.get("color", 7),
        linetype=settings.get("linetype", "CONTINUOUS")
    )


# 図形作成
for entity in data.get("entities", []):

    entity_type = entity["type"]
    layer = entity.get("layer", "0")

    if entity_type == "line":
        msp.add_line(
            entity["start"],
            entity["end"],
            dxfattribs={
                "layer": layer
            }
        )

    elif entity_type == "circle":
        msp.add_circle(
            entity["center"],
            entity["radius"],
            dxfattribs={
                "layer": layer
            }
        )

    elif entity_type == "arc":
        msp.add_arc(
            center=entity["center"],
            radius=entity["radius"],
            start_angle=entity["start_angle"],
            end_angle=entity["end_angle"],
            dxfattribs={
                "layer": layer
            }
        )

# 寸法線を入れて尺度確認
dim = msp.add_linear_dim(
    base=(50, -10),
    p1=(0, 0),
    p2=(50, 0),
    dimstyle="MECHANICAL",
)

print("Dimension style =", dim.dimension.dxf.dimstyle)
print("Dimension text  =", dim.dimension.dxf.text)

# override = dim.dimension.override()
# print("Override DIMLFAC =", override.get("dimlfac"))
# print("Override DIMTXT  =", override.get("dimtxt"))

# print("Dimension style =", dim.dimension.dxf.dimstyle)
# print("Measurement    =", dim.dimension.get_measurement())
# print("Text           =", dim.dimension.dxf.text)
# print("Override LFAC  =", dim.get("dimlfac"))

dim.render()

print("=== rendered entities ===")
for entity in dim.dimension.virtual_entities():
    if entity.dxftype() in ("TEXT", "MTEXT"):
        print(entity.dxftype(), repr(entity.dxf.text))

# --- 開いた時の視点位置を設定 ---
# center: 表示の中心にしたい座標 (X, Y)
# height: 表示する画面の縦の幅（高さ）
doc.set_modelspace_vport(height=200, center=(150, 70))

# ファイル名
name = data.get("name", "drawing")
output = Path(f"{name}.dxf")

doc.saveas(output)

print(f"DXFを作成しました: {output}")
