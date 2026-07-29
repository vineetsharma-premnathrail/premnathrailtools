import math

G = 9.81


def calculate(data: dict) -> dict:
    Z = float(data.get("number_teeth", 10))
    P = float(data.get("diametral_pitch", 1))
    phi = float(data.get("pressure_angle", 30))
    OD = float(data.get("outer_diameter", 100))
    ID = float(data.get("inner_diameter", 80))
    L = float(data.get("length_engagement", 50))
    Syt = float(data.get("yield_strength", 550))
    mt = data.get("material_type", "Steel")
    lw = float(data.get("loco_weight", 50))
    na = int(data.get("number_axles", 4))
    wpa = int(data.get("wheels_per_axle", 2))
    spd = float(data.get("speed", 25))
    wd = float(data.get("wheel_diameter", 0.92))
    mu = float(data.get("friction_coeff", 0.35))

    mod_val = 1.0 / P if P > 0 else 0
    pd_val = Z / P if P > 0 else 0
    bd = pd_val * math.cos(math.radians(phi))
    tt = (math.pi * pd_val) / (2 * Z) if Z > 0 else 0
    th = 2.0 / P if P > 0 else 0
    ad = (OD + ID) / 2
    wc = math.pi * wd
    smps = (spd * 1000) / 3600
    wrpm = (smps / wc) * 60 if wc > 0 else 0
    wn = lw * 1000 * G
    tw_count = na * wpa
    tf = (wn / tw_count) * mu if tw_count > 0 else 0
    wr = wd / 2
    tq = tf * wr
    sa = math.pi * ad * L
    ss = tq / sa if sa > 0 else 0
    als = Syt / math.sqrt(3)
    sf = als / ss if ss > 0 else 999
    al = lw / na if na > 0 else lw
    Ac = 0.647 + (13.17 / al) if al > 0 else 0.647
    Cw = 0.057 / lw if lw > 0 else 0
    rres = (Ac + 0.00933 * spd + Cw * spd**2) * lw * G
    sres = 6 * lw * G
    tres = rres + sres
    wtpw = (tres * wr) / tw_count if tw_count > 0 else 0
    tc = als * sa * (ad / 2)
    verdict = "SAFE" if sf >= 1.5 else "UNSAFE"
    return {
        "geometry": {"module": round(mod_val, 4), "pitch_dia": round(pd_val, 4), "base_dia": round(bd, 4), "tooth_thickness": round(tt, 4), "avg_dia": round(ad, 2)},
        "dynamics": {"wheel_rpm": round(wrpm, 2)},
        "forces": {"weight_N": round(wn, 2), "tangential_N": round(tf, 2), "torque_Nm": round(tq, 2)},
        "shear": {"area_mm2": round(sa, 2), "stress_Nmm2": round(ss, 4), "allowable_Nmm2": round(als, 2), "safety_factor": round(sf, 3)},
        "resistance": {"rolling_N": round(rres, 2), "starting_N": round(sres, 2), "total_N": round(tres, 2)},
        "working_torque_per_wheel": round(wtpw, 2), "torque_capacity": round(tc, 2),
        "verdict": verdict, "required_fos": 1.5, "material": mt,
    }
