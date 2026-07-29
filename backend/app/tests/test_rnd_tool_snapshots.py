"""
Tests for the per-tool calculation snapshot tables (app/modules/rnd/models/tool_calculations.py).

Legacy defines one of these tables per R&D tool but never actually writes to
them from any route — in Ideal, `history.save_history()` populates the
matching table alongside the generic `rnd_calculation_history` row, so these
are genuinely queryable (not dead schema).
"""
from app.modules.main.models.user import User
from app.modules.rnd.models.tool_calculations import (
    BrakingCalculation, HydraulicCalculation, LoadDistributionCalculation, QmaxCalculation,
    SplineCalculation, TractiveEffortCalculation, VehiclePerformanceCalculation,
)
from app.auth.jwt_handler import create_access_token


def make_user(db, email="snapshot@premnathrail.com"):
    user = User(email=email, name="Snap User", role="user", is_active=True, assigned_apps=["rnd"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def save(client, user, tool_name, inputs, results, name):
    return client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": tool_name, "inputs": inputs, "results": results, "calculation_name": name},
        headers=auth_header(user),
    )


def test_braking_save_populates_snapshot_table(client, db):
    user = make_user(db, "braking-snap@premnathrail.com")
    r = save(client, user, "braking",
             {"mass_kg": 11280, "reaction_time": 1, "num_wheels": 4, "calc_mode": "Rail",
              "rail_speed_input": "50", "rail_gradient_input": "33", "rail_gradient_type": "1 in G", "mu": 0.7},
             {"gbr": 12.5, "max_force": 50000, "rows_count": 3}, "T1")
    assert r.status_code == 200
    row = db.query(BrakingCalculation).filter(BrakingCalculation.user_id == user.id).first()
    assert row is not None
    assert row.mass_kg == 11280
    assert row.gbr_percent == 12.5
    assert row.calculation_name == "T1"
    assert row.inputs_json["calc_mode"] == "Rail"


def test_hydraulic_save_populates_snapshot_table(client, db):
    user = make_user(db, "hydraulic-snap@premnathrail.com")
    r = save(client, user, "hydraulic",
             {"calc_mode": "calc_cc", "weight": "18.5", "axles": "2", "speed": "35", "pressure": "150",
              "wheel_diameter": "560", "slope_percent": "0.0"},
             {"suggested_motor_cc": 28.0, "pump_results": [{"suggested_pump_disp_per_pump_cc": 160.0}]}, "H1")
    assert r.status_code == 200
    row = db.query(HydraulicCalculation).filter(HydraulicCalculation.user_id == user.id).first()
    assert row is not None
    assert row.weight == 18.5
    assert row.suggested_motor_cc == 28.0
    assert row.suggested_pump_cc == 160.0


def test_load_distribution_save_populates_snapshot_table(client, db):
    user = make_user(db, "ld-snap@premnathrail.com")
    r = save(client, user, "load_distribution",
             {"config_type": "Bogie", "total_load": 28.0, "front_percent": 50.0, "q1_percent": 50.0, "q3_percent": 50.0},
             {"delta_q_by_q": 0.0, "status": "success"}, "L1")
    assert r.status_code == 200
    row = db.query(LoadDistributionCalculation).filter(LoadDistributionCalculation.user_id == user.id).first()
    assert row is not None
    assert row.config_type == "Bogie"
    assert row.status == "success"


def test_qmax_save_populates_snapshot_table(client, db):
    user = make_user(db, "qmax-snap@premnathrail.com")
    r = save(client, user, "qmax",
             {"d": "134.5", "sigma_b_selection": "880", "sigma_b_custom": "", "v_head": "1.1"},
             {"d": 134.5, "sigma_b": 880, "v_head": 1.1, "qmax_kn": 35.5, "qmax_tonnes": 3.6}, "Q1")
    assert r.status_code == 200
    row = db.query(QmaxCalculation).filter(QmaxCalculation.user_id == user.id).first()
    assert row is not None
    assert row.d_mm == 134.5
    assert row.qmax_kn == 35.5


def test_spline_save_populates_snapshot_table(client, db):
    user = make_user(db, "spline-snap@premnathrail.com")
    r = save(client, user, "spline",
             {"doc_no": "PEW57-003-00", "number_teeth": "8", "diametral_pitch": "0.19", "pressure_angle": "0",
              "outer_diameter": "44.8", "inner_diameter": "39", "length_engagement": "57",
              "yield_strength": "310", "material_type": "EN-9"},
             {"safety_factor": 1.68, "verdict": "SAFE"}, "S1")
    assert r.status_code == 200
    row = db.query(SplineCalculation).filter(SplineCalculation.user_id == user.id).first()
    assert row is not None
    assert row.doc_no == "PEW57-003-00"
    assert row.verdict == "SAFE"


def test_tractive_effort_save_populates_snapshot_table(client, db):
    user = make_user(db, "te-snap@premnathrail.com")
    r = save(client, user, "tractive_effort",
             {"load": 2400, "loco_weight": 110, "gradient": 80, "grad_type": "1 in G", "curvature": 10,
              "curvature_unit": "Degree", "speed": 30, "mode": "Running"},
             {"te": 60036.63, "power": 6670.74, "ohe_current": 324.49}, "TE1")
    assert r.status_code == 200
    row = db.query(TractiveEffortCalculation).filter(TractiveEffortCalculation.user_id == user.id).first()
    assert row is not None
    assert row.mode == "Running"
    assert row.te_kg == 60036.63


def test_vehicle_performance_save_populates_snapshot_table(client, db):
    user = make_user(db, "vp-snap@premnathrail.com")
    r = save(client, user, "vehicle_performance",
             {"loco_gvw": 28000, "max_speed": 50, "num_axles": 2, "rear_axle_ratio": 5.29,
              "shunting_load": 500, "peak_power": 223.7},
             {"traction_snapshot": {"max_traction_generated_n": 279300.0, "max_traction_slipping_n": 412020.0, "result_message": "Not limited by slipping"}},
             "VP1")
    assert r.status_code == 200
    row = db.query(VehiclePerformanceCalculation).filter(VehiclePerformanceCalculation.user_id == user.id).first()
    assert row is not None
    assert row.loco_gvw_kg == 28000
    assert row.traction_status == "Not limited by slipping"


def test_snapshot_failure_does_not_break_primary_history_save(client, db):
    """A malformed/unexpected results shape for a known tool must not raise —
    the generic history row still has to save successfully."""
    user = make_user(db, "malformed-snap@premnathrail.com")
    r = save(client, user, "hydraulic", {"weight": "not-a-number"}, {"pump_results": "not-a-list"}, "Bad")
    assert r.status_code == 200
    assert r.json()["calculation_name"] == "Bad"


def test_unknown_tool_name_skips_snapshot_without_error(client, db):
    user = make_user(db, "unknown-tool@premnathrail.com")
    r = save(client, user, "some_future_tool", {"x": 1}, {"y": 2}, "Future")
    assert r.status_code == 200
