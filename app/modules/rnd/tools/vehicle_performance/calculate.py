import math

G = 9.81


def calculate(data: dict) -> dict:
    mc = float(data.get("max_curve", 200))
    ms = float(data.get("max_slope", 3))
    gvw = float(data.get("loco_gvw", 50))
    pp = float(data.get("peak_power", 500))
    mu = float(data.get("friction_mu", 0.35))
    wd = float(data.get("wheel_dia", 0.92))
    mnr = int(data.get("min_rpm", 600))
    mxr = int(data.get("max_rpm", 2500))
    gr_raw = data.get("gear_ratios", [4.5])
    if isinstance(gr_raw, str):
        grs = [float(x.strip()) for x in gr_raw.split(",") if x.strip()]
    elif isinstance(gr_raw, list):
        grs = [float(x) for x in gr_raw]
    else:
        grs = [float(gr_raw)]

    mk = gvw * 1000
    wr = wd / 2
    mt = mk * G * mu

    def resist(s, sl, cr):
        sm = s / 3.6
        return mk * G * 0.002 + mk * G * (sl / 100) + ((mk * sm**2) / cr if cr > 0 else 0) + 0.5 * 1.225 * sm**2

    def max_spd(gr, sl, cr):
        best = 0
        for s in range(0, 201, 5):
            res = resist(s, sl, cr)
            sm = s / 3.6
            rpm = (sm / (math.pi * wd)) * 60 * gr if wd > 0 else 0
            if rpm < mnr: rpm = mnr
            if rpm > mxr: continue
            tq = (pp * 1000 * 60) / (rpm * 2 * math.pi) if rpm > 0 else 0
            wf = min((tq * gr * 0.95) / wr if wr > 0 else 0, mt)
            if wf >= res: best = s
            else: break
        return best

    snap = [
        {"gear_ratio": g, "max_speed_level": max_spd(g, 0, 9999),
         "max_speed_slope": max_spd(g, ms, 9999), "max_speed_curve": max_spd(g, 0, mc)}
        for g in grs
    ]
    slopes = [round(ms * i / 10, 2) for i in range(11)]
    table = []
    for sl in slopes:
        row = {"slope_pct": sl}
        for g in grs:
            row["gear_" + str(g)] = max_spd(g, sl, 9999)
        table.append(row)

    return {
        "loco_gvw": gvw, "peak_power_kW": pp,
        "max_traction_kN": round(mt / 1000, 2),
        "traction_snapshot": snap,
        "speed_slope_table": table,
        "gear_ratios": grs,
    }
