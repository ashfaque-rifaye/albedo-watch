"""India registry — cities, states, corridors, authorities, languages.

Adding a city or a whole country is a data change, not a code change: this is
the seam that takes Albedo-Watch from one state to all of India (and to other
BRICS nations — see ``COUNTRIES``).

``stations`` = approximate count of continuous ambient air-quality monitoring
stations (CAAQMS) per city from public CPCB listings. Used only to estimate
*monitoring coverage* for blind-spot detection; labelled approximate in the UI.
``truth`` marks cities used as federated-learning ground-truth sites.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class State:
    code: str
    name: str
    languages: tuple[str, ...]          # advisory languages, most-spoken first (ISO 639)
    authority: str                      # State Pollution Control Board / Committee
    authority_short: str


@dataclass(frozen=True)
class City:
    id: str
    name: str
    state: str
    lat: float
    lon: float
    pop_m: float                        # urban-agglomeration population, millions (approx.)
    stations: int
    profile: str                        # source-profile family for apportionment priors
    truth: bool = False
    local_name: str = ""
    country: str = "IN"
    index: str = "naqi"          # naqi (CPCB, India) | epa (US EPA AQI, rest of world)


STATES: dict[str, State] = {s.code: s for s in [
    State("DL", "Delhi", ("hi", "en", "pa", "ur"), "Delhi Pollution Control Committee", "DPCC"),
    State("HR", "Haryana", ("hi", "en"), "Haryana State Pollution Control Board", "HSPCB"),
    State("PB", "Punjab", ("pa", "hi", "en"), "Punjab Pollution Control Board", "PPCB"),
    State("UP", "Uttar Pradesh", ("hi", "ur", "en"), "Uttar Pradesh Pollution Control Board", "UPPCB"),
    State("BR", "Bihar", ("hi", "mai", "en"), "Bihar State Pollution Control Board", "BSPCB"),
    State("WB", "West Bengal", ("bn", "hi", "en"), "West Bengal Pollution Control Board", "WBPCB"),
    State("JH", "Jharkhand", ("hi", "en"), "Jharkhand State Pollution Control Board", "JSPCB"),
    State("OD", "Odisha", ("or", "en"), "State Pollution Control Board, Odisha", "SPCB-OD"),
    State("RJ", "Rajasthan", ("hi", "en"), "Rajasthan State Pollution Control Board", "RSPCB"),
    State("GJ", "Gujarat", ("gu", "hi", "en"), "Gujarat Pollution Control Board", "GPCB"),
    State("MH", "Maharashtra", ("mr", "hi", "en"), "Maharashtra Pollution Control Board", "MPCB"),
    State("MP", "Madhya Pradesh", ("hi", "en"), "Madhya Pradesh Pollution Control Board", "MPPCB"),
    State("CG", "Chhattisgarh", ("hi", "en"), "Chhattisgarh Environment Conservation Board", "CECB"),
    State("TG", "Telangana", ("te", "ur", "en"), "Telangana State Pollution Control Board", "TSPCB"),
    State("AP", "Andhra Pradesh", ("te", "en"), "Andhra Pradesh Pollution Control Board", "APPCB"),
    State("KA", "Karnataka", ("kn", "en"), "Karnataka State Pollution Control Board", "KSPCB"),
    State("TN", "Tamil Nadu", ("ta", "en"), "Tamil Nadu Pollution Control Board", "TNPCB"),
    State("KL", "Kerala", ("ml", "en"), "Kerala State Pollution Control Board", "KSPCB-KL"),
    State("GA", "Goa", ("kok", "en"), "Goa State Pollution Control Board", "GSPCB"),
    State("AS", "Assam", ("as", "bn", "en"), "Pollution Control Board, Assam", "PCBA"),
    State("ML", "Meghalaya", ("en", "kha"), "Meghalaya State Pollution Control Board", "MSPCB"),
    State("MN", "Manipur", ("mni", "en"), "Manipur Pollution Control Board", "MPCB-MN"),
    State("UK", "Uttarakhand", ("hi", "en"), "Uttarakhand Environment Protection & Pollution Control Board", "UEPPCB"),
    State("HP", "Himachal Pradesh", ("hi", "en"), "Himachal Pradesh State Pollution Control Board", "HPSPCB"),
    State("JK", "Jammu & Kashmir", ("ur", "ks", "hi", "en"), "J&K Pollution Control Committee", "JKPCC"),
    State("CH", "Chandigarh", ("hi", "pa", "en"), "Chandigarh Pollution Control Committee", "CPCC"),
]}

# NCR cities fall under the Commission for Air Quality Management's GRAP.
NCR = {"delhi", "gurugram", "noida", "ghaziabad", "faridabad", "sonipat", "panipat"}

CITIES: list[City] = [
    City("delhi", "Delhi", "DL", 28.6139, 77.2090, 32.9, 40, "igp_metro", True, "दिल्ली"),
    City("gurugram", "Gurugram", "HR", 28.4595, 77.0266, 1.5, 4, "igp_metro", False, "गुरुग्राम"),
    City("faridabad", "Faridabad", "HR", 28.4089, 77.3178, 1.9, 4, "igp_industrial"),
    City("noida", "Noida", "UP", 28.5355, 77.3910, 1.0, 4, "igp_metro"),
    City("ghaziabad", "Ghaziabad", "UP", 28.6692, 77.4538, 2.4, 4, "igp_industrial"),
    City("sonipat", "Sonipat", "HR", 28.9931, 77.0151, 0.4, 1, "igp_town"),
    City("panipat", "Panipat", "HR", 29.3909, 76.9635, 0.6, 1, "igp_industrial", True),
    City("chandigarh", "Chandigarh", "CH", 30.7333, 76.7794, 1.2, 3, "igp_town", True),
    City("ludhiana", "Ludhiana", "PB", 30.9010, 75.8573, 1.9, 1, "igp_industrial", True, "ਲੁਧਿਆਣਾ"),
    City("amritsar", "Amritsar", "PB", 31.6340, 74.8723, 1.3, 1, "igp_town", False, "ਅੰਮ੍ਰਿਤਸਰ"),
    City("bathinda", "Bathinda", "PB", 30.2110, 74.9455, 0.4, 1, "igp_town"),
    City("patiala", "Patiala", "PB", 30.3398, 76.3869, 0.5, 1, "igp_town"),
    City("lucknow", "Lucknow", "UP", 26.8467, 80.9462, 3.9, 6, "igp_metro", True, "लखनऊ"),
    City("kanpur", "Kanpur", "UP", 26.4499, 80.3319, 3.2, 4, "igp_industrial", False, "कानपुर"),
    City("agra", "Agra", "UP", 27.1767, 78.0081, 1.8, 2, "igp_town"),
    City("varanasi", "Varanasi", "UP", 25.3176, 82.9739, 1.6, 4, "igp_town", False, "वाराणसी"),
    City("prayagraj", "Prayagraj", "UP", 25.4358, 81.8463, 1.4, 2, "igp_town"),
    City("patna", "Patna", "BR", 25.5941, 85.1376, 2.5, 6, "igp_metro", True, "पटना"),
    City("muzaffarpur", "Muzaffarpur", "BR", 26.1209, 85.3647, 0.5, 3, "igp_town"),
    City("kolkata", "Kolkata", "WB", 22.5726, 88.3639, 15.0, 7, "coastal_metro", True, "কলকাতা"),
    City("asansol", "Asansol", "WB", 23.6739, 86.9524, 1.3, 1, "coal_belt"),
    City("dhanbad", "Dhanbad", "JH", 23.7957, 86.4304, 1.2, 1, "coal_belt"),
    City("ranchi", "Ranchi", "JH", 23.3441, 85.3096, 1.5, 1, "plateau_city"),
    City("bhubaneswar", "Bhubaneswar", "OD", 20.2961, 85.8245, 1.0, 2, "coastal_city", True, "ଭୁବନେଶ୍ୱର"),
    City("jaipur", "Jaipur", "RJ", 26.9124, 75.7873, 3.9, 3, "arid_metro", True, "जयपुर"),
    City("jodhpur", "Jodhpur", "RJ", 26.2389, 73.0243, 1.4, 1, "arid_city"),
    City("ahmedabad", "Ahmedabad", "GJ", 23.0225, 72.5714, 8.4, 9, "industrial_metro", True, "અમદાવાદ"),
    City("vadodara", "Vadodara", "GJ", 22.3072, 73.1812, 2.1, 1, "industrial_metro"),
    City("surat", "Surat", "GJ", 21.1702, 72.8311, 6.6, 1, "industrial_metro"),
    City("vapi", "Vapi", "GJ", 20.3893, 72.9106, 0.2, 1, "industrial_metro"),
    City("mumbai", "Mumbai", "MH", 19.0760, 72.8777, 20.7, 28, "coastal_metro", True, "मुंबई"),
    City("pune", "Pune", "MH", 18.5204, 73.8567, 7.4, 9, "plateau_city", False, "पुणे"),
    City("nagpur", "Nagpur", "MH", 21.1458, 79.0882, 2.9, 4, "plateau_city"),
    City("bhopal", "Bhopal", "MP", 23.2599, 77.4126, 2.4, 2, "plateau_city", True),
    City("indore", "Indore", "MP", 22.7196, 75.8577, 3.3, 2, "plateau_city"),
    City("raipur", "Raipur", "CG", 21.2514, 81.6296, 1.4, 2, "coal_belt", True),
    City("hyderabad", "Hyderabad", "TG", 17.3850, 78.4867, 10.5, 14, "plateau_city", True, "హైదరాబాద్"),
    City("visakhapatnam", "Visakhapatnam", "AP", 17.6868, 83.2185, 2.2, 2, "coastal_city", True),
    City("vijayawada", "Vijayawada", "AP", 16.5062, 80.6480, 1.8, 1, "plateau_city"),
    City("bengaluru", "Bengaluru", "KA", 12.9716, 77.5946, 13.6, 10, "plateau_city", True, "ಬೆಂಗಳೂರು"),
    City("mysuru", "Mysuru", "KA", 12.2958, 76.6394, 1.1, 1, "plateau_city"),
    City("chennai", "Chennai", "TN", 13.0827, 80.2707, 11.5, 8, "coastal_metro", True, "சென்னை"),
    City("coimbatore", "Coimbatore", "TN", 11.0168, 76.9558, 2.8, 1, "plateau_city"),
    City("madurai", "Madurai", "TN", 9.9252, 78.1198, 1.6, 1, "plateau_city"),
    City("kochi", "Kochi", "KL", 9.9312, 76.2673, 2.3, 2, "coastal_city", True, "കൊച്ചി"),
    City("thiruvananthapuram", "Thiruvananthapuram", "KL", 8.5241, 76.9366, 1.7, 2, "coastal_city"),
    City("panaji", "Panaji", "GA", 15.4909, 73.8278, 0.1, 1, "coastal_city"),
    City("guwahati", "Guwahati", "AS", 26.1445, 91.7362, 1.2, 2, "valley_city", True, "গুৱাহাটী"),
    City("shillong", "Shillong", "ML", 25.5788, 91.8933, 0.4, 1, "hill_city"),
    City("imphal", "Imphal", "MN", 24.8170, 93.9368, 0.6, 1, "valley_city"),
    City("dehradun", "Dehradun", "UK", 30.3165, 78.0322, 0.8, 1, "valley_city", True),
    City("shimla", "Shimla", "HP", 31.1048, 77.1734, 0.2, 1, "hill_city"),
    City("srinagar", "Srinagar", "JK", 34.0837, 74.7973, 1.5, 1, "valley_city", True),
]
CITY_BY_ID: dict[str, City] = {c.id: c for c in CITIES}


@dataclass(frozen=True)
class Corridor:
    id: str
    name: str
    kind: str
    cities: tuple[str, ...]
    blurb: str
    waypoints: tuple[tuple[float, float], ...] = field(default=())


CORRIDORS: list[Corridor] = [
    Corridor("igp", "Indo-Gangetic Grand Trunk", "agro-industrial",
             ("amritsar", "ludhiana", "panipat", "delhi", "agra", "kanpur", "prayagraj", "varanasi", "patna", "asansol", "kolkata"),
             "Home to ~40% of India. Stubble smoke, brick kilns and traffic stack up under winter inversions."),
    Corridor("ncr", "Delhi–NCR Ring", "metropolitan",
             ("sonipat", "delhi", "ghaziabad", "noida", "faridabad", "gurugram"),
             "India's most-monitored airshed — and still the worst winter smog episodes on Earth."),
    Corridor("dmic", "Delhi–Mumbai Industrial", "freight",
             ("gurugram", "jaipur", "ahmedabad", "vadodara", "surat", "vapi", "mumbai"),
             "1,500 km freight spine; diesel logistics plus chemical clusters in Gujarat."),
    Corridor("golden", "Mumbai–Pune Expressway", "urban",
             ("mumbai", "pune"), "Construction boom plus the Western Ghats trapping coastal haze."),
    Corridor("south", "Chennai–Bengaluru", "industrial",
             ("chennai", "bengaluru", "mysuru"), "Auto & electronics belt; fast-growing, thinly monitored."),
    Corridor("coal", "Eastern Coal Belt", "mining",
             ("raipur", "ranchi", "dhanbad", "asansol", "kolkata"), "Mines, thermal plants and steel — India's thinnest monitoring per tonne emitted."),
]

# Source-apportionment priors (share of PM2.5) per profile family — indicative,
# informed by public studies (IIT-Kanpur Delhi 2016, TERI–ARAI 2018, CPCB city
# action plans). Biomass and dust are then overwritten by live evidence.
PROFILES: dict[str, dict[str, float]] = {
    "igp_metro":       {"transport": 0.26, "industry": 0.16, "residential": 0.14, "construction": 0.10, "dust": 0.18, "biomass": 0.16},
    "igp_industrial":  {"transport": 0.20, "industry": 0.28, "residential": 0.14, "construction": 0.08, "dust": 0.16, "biomass": 0.14},
    "igp_town":        {"transport": 0.14, "industry": 0.12, "residential": 0.22, "construction": 0.06, "dust": 0.20, "biomass": 0.26},
    "coastal_metro":   {"transport": 0.30, "industry": 0.20, "residential": 0.12, "construction": 0.14, "dust": 0.16, "biomass": 0.08},
    "coastal_city":    {"transport": 0.26, "industry": 0.18, "residential": 0.16, "construction": 0.12, "dust": 0.20, "biomass": 0.08},
    "industrial_metro":{"transport": 0.22, "industry": 0.32, "residential": 0.10, "construction": 0.12, "dust": 0.18, "biomass": 0.06},
    "plateau_city":    {"transport": 0.30, "industry": 0.14, "residential": 0.12, "construction": 0.16, "dust": 0.22, "biomass": 0.06},
    "arid_metro":      {"transport": 0.22, "industry": 0.12, "residential": 0.10, "construction": 0.10, "dust": 0.40, "biomass": 0.06},
    "arid_city":       {"transport": 0.16, "industry": 0.10, "residential": 0.10, "construction": 0.08, "dust": 0.50, "biomass": 0.06},
    "coal_belt":       {"transport": 0.16, "industry": 0.38, "residential": 0.16, "construction": 0.06, "dust": 0.18, "biomass": 0.06},
    "valley_city":     {"transport": 0.24, "industry": 0.08, "residential": 0.30, "construction": 0.10, "dust": 0.16, "biomass": 0.12},
    "hill_city":       {"transport": 0.30, "industry": 0.04, "residential": 0.30, "construction": 0.10, "dust": 0.14, "biomass": 0.12},
}

LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "pa": "Punjabi", "ur": "Urdu", "bn": "Bengali", "mai": "Maithili",
    "or": "Odia", "gu": "Gujarati", "mr": "Marathi", "te": "Telugu", "kn": "Kannada", "ta": "Tamil",
    "ml": "Malayalam", "kok": "Konkani", "as": "Assamese", "kha": "Khasi", "mni": "Manipuri", "ks": "Kashmiri",
}

# Coverage summary (competition rule: BRICS applicability) — India is the deep flagship.
COUNTRIES = {
    "IN": {"name": "India", "status": "live", "cities": len(CITIES)},
    "BR": {"name": "Brazil", "status": "registry-ready", "note": "Amazon fire smoke → São Paulo; same FIRMS + CAMS pipeline"},
    "ZA": {"name": "South Africa", "status": "registry-ready", "note": "Highveld coal belt — mirrors India's Eastern Coal Belt"},
    "CN": {"name": "China", "status": "registry-ready", "note": "North China Plain winter haze — structurally identical to the IGP"},
    "ID": {"name": "Indonesia", "status": "registry-ready", "note": "Peatland fire haze across ASEAN borders"},
}


INDIA_CITIES: list[City] = list(CITIES)

# ---- the rest of the world ------------------------------------------------ #
from .world import COUNTRIES as WORLD_COUNTRIES, EXTRA_PROFILES, REGION_PROFILE, WORLD_CITY_ROWS  # noqa: E402

PROFILES.update(EXTRA_PROFILES)
for _id, _name, _cc, _lat, _lon, _pop, _truth in WORLD_CITY_ROWS:
    _country = WORLD_COUNTRIES[_cc]
    CITIES.append(City(_id, _name, "", _lat, _lon, _pop, 0, REGION_PROFILE.get(_country.region, "western_metro"),
                       _truth, "", _cc, "epa"))
CITY_BY_ID = {c.id: c for c in CITIES}

LANGUAGE_NAMES.update({
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "mn": "Mongolian", "th": "Thai", "vi": "Vietnamese",
    "id": "Indonesian", "ms": "Malay", "tl": "Filipino", "my": "Burmese", "km": "Khmer", "lo": "Lao", "ne": "Nepali",
    "si": "Sinhala", "ps": "Pashto", "fa": "Persian", "ar": "Arabic", "ku": "Kurdish", "uz": "Uzbek", "kk": "Kazakh",
    "ky": "Kyrgyz", "ru": "Russian", "tr": "Turkish", "he": "Hebrew", "fr": "French", "de": "German", "es": "Spanish",
    "ca": "Catalan", "it": "Italian", "nl": "Dutch", "pl": "Polish", "cs": "Czech", "hu": "Hungarian", "ro": "Romanian",
    "bg": "Bulgarian", "sr": "Serbian", "bs": "Bosnian", "hr": "Croatian", "mk": "Macedonian", "sq": "Albanian",
    "el": "Greek", "pt": "Portuguese", "ga": "Irish", "sv": "Swedish", "no": "Norwegian", "da": "Danish", "fi": "Finnish",
    "uk": "Ukrainian", "be": "Belarusian", "ha": "Hausa", "yo": "Yoruba", "ln": "Lingala", "zu": "Zulu", "af": "Afrikaans",
    "sw": "Swahili", "am": "Amharic", "rw": "Kinyarwanda", "ak": "Akan", "wo": "Wolof", "bm": "Bambara", "sn": "Shona",
    "mg": "Malagasy", "qu": "Quechua", "ay": "Aymara", "gn": "Guarani", "mi": "Māori", "tpi": "Tok Pisin",
})


def is_india(city: City) -> bool:
    return city.country == "IN"


def node_of(city: City) -> str:
    """Federated-learning node: an Indian state, or a country."""
    return f"IN-{city.state}" if is_india(city) else city.country


def node_name(node: str) -> str:
    if node.startswith("IN-"):
        return STATES[node[3:]].name
    return WORLD_COUNTRIES[node].name if node in WORLD_COUNTRIES else node


def node_authority(node: str) -> str:
    if node.startswith("IN-"):
        return STATES[node[3:]].authority_short
    c = WORLD_COUNTRIES.get(node)
    return c.authority.split(" (")[0].split(" / ")[0] if c else node


def region_name(city: City) -> str:
    return STATES[city.state].name if is_india(city) else WORLD_COUNTRIES[city.country].name


def country_name(city: City) -> str:
    return WORLD_COUNTRIES[city.country].name


def languages_of(city: City) -> tuple[str, ...]:
    return STATES[city.state].languages if is_india(city) else WORLD_COUNTRIES[city.country].languages


def languages_for_country(cc: str, admin: str | None = None) -> tuple[str, ...]:
    """Advisory languages for any point on Earth: India resolves to the state, else the country."""
    if cc == "IN" and admin:
        for st in STATES.values():
            if st.name.lower() == admin.lower() or admin.lower().startswith(st.name.lower()):
                return st.languages
    c = WORLD_COUNTRIES.get(cc)
    return c.languages if c else ("en",)


def authority_for(city: City) -> dict:
    if is_india(city):
        st = STATES[city.state]
        ncr = city.id in NCR
        return {
            "primary": "Commission for Air Quality Management in NCR" if ncr else st.authority,
            "primary_short": "CAQM" if ncr else st.authority_short,
            "state_board": st.authority,
            "municipal": f"{city.name} Municipal Corporation",
            "framework": "GRAP (CAQM, 2024 revision)" if ncr else "NCAP City Clean Air Action Plan · GRAP-style graded response",
        }
    c = WORLD_COUNTRIES[city.country]
    return {
        "primary": c.authority, "primary_short": c.authority.split(" (")[0].split(" / ")[0][:40],
        "state_board": c.authority, "municipal": f"{city.name} city administration",
        "framework": "Local air-quality episode plan · WHO Air Quality Guidelines (2021) as reference",
    }


def authority_for_country(cc: str, admin: str | None = None) -> str:
    if cc == "IN" and admin:
        for st in STATES.values():
            if st.name.lower() == admin.lower():
                return st.authority
    c = WORLD_COUNTRIES.get(cc)
    return c.authority if c else "Local environmental authority"
