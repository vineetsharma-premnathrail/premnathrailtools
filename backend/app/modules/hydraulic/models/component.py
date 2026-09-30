from sqlalchemy import String, Integer, Float, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# category → code prefix. The prefix is baked into the auto-generated
# component code, which is why the category can't change after creation.
HYD_COMPONENT_CATEGORIES: dict[str, str] = {
    "pump": "PMP",
    "motor": "MTR",
    "cylinder": "CYL",
    "directional_valve": "DCV",
    "pressure_valve": "PCV",
    "flow_valve": "FCV",
    "check_valve": "CHV",
    "proportional_valve": "PRV",
    "accumulator": "ACC",
    "filter": "FLT",
    "reservoir": "RES",
    "cooler": "CLR",
    "hose": "HOS",
    "fitting": "FIT",
    "manifold": "MFD",
    "compressor": "CMP",
    "air_receiver": "ARV",
    "frl_unit": "FRL",
    "air_dryer": "DRY",
    "pneumatic_actuator": "PAC",
    "solenoid_valve": "SOV",
    "sensor": "SEN",
    "gauge": "GAU",
    "seal": "SEL",
    "other": "OTH",
}
HYD_COMPONENT_STATUSES = ("active", "obsolete")


class HydComponent(Base, TimestampMixin, SoftDeleteMixin):
    """Component master — one catalog entry per fluid-power component model
    (a specific pump, valve, cylinder, FRL…). BOM lines and spare parts
    point here. `store_item_id` links it to the Store item it's bought and
    stocked as, when it is one.

    Only the ratings that apply to a category are filled (bore/rod/stroke
    for cylinders, displacement for pumps and motors); anything else goes
    in `specifications` as label/value pairs."""

    __tablename__ = "hyd_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    manufacturer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    model_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)

    rated_pressure_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_pressure_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    flow_rate_lpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    displacement_cc: Mapped[float | None] = mapped_column(Float, nullable=True)
    bore_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    rod_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    stroke_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    port_size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mounting: Mapped[str | None] = mapped_column(String(100), nullable=True)
    media: Mapped[str | None] = mapped_column(String(100), nullable=True)
    seal_material: Mapped[str | None] = mapped_column(String(50), nullable=True)
    temp_min_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    temp_max_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # [{"label": "Filtration ratio", "value": "β10 ≥ 200"}, …]
    specifications: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    datasheet_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
