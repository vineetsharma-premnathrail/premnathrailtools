from pydantic import BaseModel

class SplineInput(BaseModel):
    calc_mode: str  # 'calc_spline'
    # Geometry
    number_teeth: str
    diametral_pitch: str
    pressure_angle: str
    outer_diameter: str
    inner_diameter: str
    length_engagement: str
    # Material
    yield_strength: str
    material_type: str
    # Operating
    loco_weight: str
    number_axles: str
    wheels_per_axle: str
    speed: str
    wheel_diameter: str
    friction_coeff: str
    # optional metadata
    doc_no: str | None = None
    made_by: str | None = None
    checked_by: str | None = None
    approved_by: str | None = None
    doc_date: str | None = None
