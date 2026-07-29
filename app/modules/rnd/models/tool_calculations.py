"""Per-tool calculation snapshots — one table per R&D tool, populated
alongside the generic `rnd_calculation_history` row on every save so the
common numeric fields are directly queryable (no JSON unpacking needed) for
whichever tool produced them. In legacy this schema existed but no route ever
wrote to it; here `history.save_history()` populates the matching table."""

from datetime import datetime
from typing import Any
from sqlalchemy import Integer, String, Float, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class BrakingCalculation(Base):
    __tablename__ = "rnd_braking_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    reaction_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    num_wheels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calc_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    mu: Mapped[float | None] = mapped_column(Float, nullable=True)
    rail_speed_input: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rail_gradient_input: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rail_gradient_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    max_braking_force_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    gbr_percent: Mapped[float | None] = mapped_column(Float, nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class HydraulicCalculation(Base):
    __tablename__ = "rnd_hydraulic_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    calc_mode: Mapped[str | None] = mapped_column(String(50), nullable=True)
    weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    axles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure: Mapped[float | None] = mapped_column(Float, nullable=True)
    wheel_diameter: Mapped[float | None] = mapped_column(Float, nullable=True)
    slope_percent: Mapped[float | None] = mapped_column(Float, nullable=True)

    suggested_motor_cc: Mapped[float | None] = mapped_column(Float, nullable=True)
    suggested_pump_cc: Mapped[float | None] = mapped_column(Float, nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LoadDistributionCalculation(Base):
    __tablename__ = "rnd_load_distribution_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    config_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_load: Mapped[float | None] = mapped_column(Float, nullable=True)
    front_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    q1_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    q3_percent: Mapped[float | None] = mapped_column(Float, nullable=True)

    delta_q_ratio_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str | None] = mapped_column(String(10), nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class QmaxCalculation(Base):
    __tablename__ = "rnd_qmax_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    d_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    sigma_b: Mapped[float | None] = mapped_column(Float, nullable=True)
    v_head: Mapped[float | None] = mapped_column(Float, nullable=True)

    qmax_kn: Mapped[float | None] = mapped_column(Float, nullable=True)
    qmax_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SplineCalculation(Base):
    __tablename__ = "rnd_spline_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    doc_no: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    number_teeth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diametral_pitch: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    outer_diameter: Mapped[float | None] = mapped_column(Float, nullable=True)
    inner_diameter: Mapped[float | None] = mapped_column(Float, nullable=True)
    length_engagement: Mapped[float | None] = mapped_column(Float, nullable=True)
    yield_strength: Mapped[float | None] = mapped_column(Float, nullable=True)
    material_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    safety_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TractiveEffortCalculation(Base):
    __tablename__ = "rnd_tractive_effort_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    load: Mapped[float | None] = mapped_column(Float, nullable=True)
    loco_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    gradient: Mapped[float | None] = mapped_column(Float, nullable=True)
    grad_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    curvature: Mapped[float | None] = mapped_column(Float, nullable=True)
    curvature_unit: Mapped[str | None] = mapped_column(String(20), nullable=True)

    te_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_hp: Mapped[float | None] = mapped_column(Float, nullable=True)
    ohe_current_a: Mapped[float | None] = mapped_column(Float, nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VehiclePerformanceCalculation(Base):
    __tablename__ = "rnd_vehicle_performance_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    loco_gvw_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    num_axles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rear_axle_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    shunting_load_t: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_power_kw: Mapped[float | None] = mapped_column(Float, nullable=True)

    max_traction_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    traction_no_slip_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    traction_status: Mapped[str | None] = mapped_column(String(50), nullable=True)

    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
