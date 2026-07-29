import math


def calculate(data: dict) -> dict:
    load = float(data.get("load", 0))
    lw = float(data.get("loco_weight", 0))
    grad = float(data.get("gradient", 0))
    curv = float(data.get("curvature", 0))
    spd = float(data.get("speed", 0))
    mode = data.get("mode", "Running")
    gt = data.get("grad_type", "Degree")
    cu = data.get("curvature_unit", "Radius(m)")
    tw = load + lw
    if gt == "Degree":
        gr = math.tan(math.radians(grad)) * 1000
    else:
        gr = 1000 / grad if grad != 0 else 0
    if cu == "Radius(m)":
        cr = 700 / curv if curv != 0 else 0
    else:
        cr = curv
    if mode == "Start":
        wrr, lrr, cs = 4.0, 6.0, 1.0
    else:
        wrr, lrr, cs = 1.3505, 2.913, spd
    t1 = load * wrr
    t2 = lw * lrr
    t3 = tw * gr
    t4 = tw * cr
    te = t1 + t2 + t3 + t4
    pw = (te * cs) / 270
    oc = (pw * 735.5) / (22500 * 0.84 * 0.8)
    return {
        "mode": mode, "total_weight": round(tw, 2),
        "T1_kgf": round(t1, 2), "T2_kgf": round(t2, 2),
        "T3_kgf": round(t3, 2), "T4_kgf": round(t4, 2),
        "total_TE_kgf": round(te, 2),
        "power_kW": round(pw, 2), "ohe_current_A": round(oc, 2),
    }
