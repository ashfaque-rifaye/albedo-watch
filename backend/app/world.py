"""World registry — countries and major cities beyond India.

India keeps its deep, state-level registry (``registry.py``: CPCB NAQI, GRAP,
State Pollution Control Boards). Everywhere else uses this country-level
registry: languages for advisories, the national environment authority, and
the index shown (US EPA AQI from CAMS; the country's own official index comes
live from Google Air Quality in the place view).

Populations are approximate metro figures (millions); coordinates city centres.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Country:
    code: str
    name: str
    languages: tuple[str, ...]
    authority: str
    region: str
    brics: bool = False


_C = [
    # --- South & Central Asia ---
    ("IN", "India", ("hi", "en"), "Central Pollution Control Board / State PCBs", "South Asia", True),
    ("PK", "Pakistan", ("ur", "en", "pa"), "Pakistan Environmental Protection Agency / provincial EPAs", "South Asia"),
    ("BD", "Bangladesh", ("bn", "en"), "Department of Environment, Bangladesh", "South Asia"),
    ("NP", "Nepal", ("ne", "en"), "Department of Environment, Nepal", "South Asia"),
    ("LK", "Sri Lanka", ("si", "ta", "en"), "Central Environmental Authority", "South Asia"),
    ("AF", "Afghanistan", ("ps", "fa"), "National Environmental Protection Agency", "South Asia"),
    ("UZ", "Uzbekistan", ("uz", "ru"), "Ministry of Ecology, Environmental Protection and Climate Change", "Central Asia"),
    ("KZ", "Kazakhstan", ("kk", "ru"), "Ministry of Ecology and Natural Resources", "Central Asia"),
    ("KG", "Kyrgyzstan", ("ky", "ru"), "Ministry of Natural Resources, Ecology and Technical Supervision", "Central Asia"),
    # --- East & South-East Asia ---
    ("CN", "China", ("zh", "en"), "Ministry of Ecology and Environment (MEE)", "East Asia", True),
    ("HK", "Hong Kong", ("zh", "en"), "Environmental Protection Department", "East Asia"),
    ("TW", "Taiwan", ("zh", "en"), "Ministry of Environment", "East Asia"),
    ("KR", "South Korea", ("ko", "en"), "Ministry of Environment (AirKorea)", "East Asia"),
    ("JP", "Japan", ("ja", "en"), "Ministry of the Environment", "East Asia"),
    ("MN", "Mongolia", ("mn", "en"), "Ministry of Environment and Tourism", "East Asia"),
    ("TH", "Thailand", ("th", "en"), "Pollution Control Department", "South-East Asia"),
    ("VN", "Vietnam", ("vi", "en"), "Ministry of Agriculture and Environment", "South-East Asia"),
    ("ID", "Indonesia", ("id", "en"), "Ministry of Environment (KLH)", "South-East Asia", True),
    ("MY", "Malaysia", ("ms", "en"), "Department of Environment Malaysia", "South-East Asia"),
    ("SG", "Singapore", ("en", "ms", "zh", "ta"), "National Environment Agency", "South-East Asia"),
    ("PH", "Philippines", ("tl", "en"), "Environmental Management Bureau (DENR)", "South-East Asia"),
    ("MM", "Myanmar", ("my", "en"), "Environmental Conservation Department", "South-East Asia"),
    ("KH", "Cambodia", ("km", "en"), "Ministry of Environment", "South-East Asia"),
    ("LA", "Laos", ("lo", "en"), "Ministry of Natural Resources and Environment", "South-East Asia"),
    # --- Middle East ---
    ("IR", "Iran", ("fa", "en"), "Department of Environment", "Middle East", True),
    ("IQ", "Iraq", ("ar", "ku"), "Ministry of Environment", "Middle East"),
    ("SA", "Saudi Arabia", ("ar", "en"), "National Center for Environmental Compliance", "Middle East", True),
    ("AE", "United Arab Emirates", ("ar", "en"), "Ministry of Climate Change and Environment", "Middle East", True),
    ("QA", "Qatar", ("ar", "en"), "Ministry of Environment and Climate Change", "Middle East"),
    ("KW", "Kuwait", ("ar", "en"), "Kuwait Environment Public Authority", "Middle East"),
    ("OM", "Oman", ("ar", "en"), "Environment Authority", "Middle East"),
    ("TR", "Türkiye", ("tr", "en"), "Ministry of Environment, Urbanisation and Climate Change", "Middle East"),
    ("IL", "Israel", ("he", "ar", "en"), "Ministry of Environmental Protection", "Middle East"),
    ("JO", "Jordan", ("ar", "en"), "Ministry of Environment", "Middle East"),
    ("LB", "Lebanon", ("ar", "fr", "en"), "Ministry of Environment", "Middle East"),
    # --- Europe ---
    ("GB", "United Kingdom", ("en",), "DEFRA / Environment Agency", "Europe"),
    ("FR", "France", ("fr",), "Ministère de la Transition écologique / AASQA networks", "Europe"),
    ("DE", "Germany", ("de",), "Umweltbundesamt (UBA)", "Europe"),
    ("ES", "Spain", ("es", "ca"), "Ministerio para la Transición Ecológica (MITECO)", "Europe"),
    ("IT", "Italy", ("it",), "ISPRA / Regional ARPA agencies", "Europe"),
    ("NL", "Netherlands", ("nl", "en"), "RIVM", "Europe"),
    ("BE", "Belgium", ("nl", "fr", "de"), "IRCEL-CELINE", "Europe"),
    ("AT", "Austria", ("de",), "Umweltbundesamt Austria", "Europe"),
    ("CH", "Switzerland", ("de", "fr", "it"), "Federal Office for the Environment (FOEN)", "Europe"),
    ("PL", "Poland", ("pl",), "Chief Inspectorate of Environmental Protection (GIOŚ)", "Europe"),
    ("CZ", "Czechia", ("cs",), "Czech Hydrometeorological Institute (ČHMÚ)", "Europe"),
    ("HU", "Hungary", ("hu",), "National Air Quality Network (OLM)", "Europe"),
    ("RO", "Romania", ("ro",), "National Environmental Protection Agency", "Europe"),
    ("BG", "Bulgaria", ("bg",), "Executive Environment Agency", "Europe"),
    ("RS", "Serbia", ("sr",), "Serbian Environmental Protection Agency (SEPA)", "Europe"),
    ("BA", "Bosnia and Herzegovina", ("bs", "hr", "sr"), "Federal Hydrometeorological Institute", "Europe"),
    ("MK", "North Macedonia", ("mk", "sq"), "Ministry of Environment and Physical Planning", "Europe"),
    ("GR", "Greece", ("el",), "Ministry of Environment and Energy", "Europe"),
    ("PT", "Portugal", ("pt",), "Agência Portuguesa do Ambiente", "Europe"),
    ("IE", "Ireland", ("en", "ga"), "Environmental Protection Agency Ireland", "Europe"),
    ("SE", "Sweden", ("sv",), "Swedish Environmental Protection Agency", "Europe"),
    ("NO", "Norway", ("no",), "Norwegian Environment Agency", "Europe"),
    ("DK", "Denmark", ("da",), "Danish Environmental Protection Agency", "Europe"),
    ("FI", "Finland", ("fi", "sv"), "Finnish Meteorological Institute / SYKE", "Europe"),
    ("UA", "Ukraine", ("uk",), "Ministry of Environmental Protection and Natural Resources", "Europe"),
    ("BY", "Belarus", ("be", "ru"), "Ministry of Natural Resources and Environmental Protection", "Europe"),
    ("RU", "Russia", ("ru",), "Roshydromet / Rosprirodnadzor", "Europe", True),
    # --- Africa ---
    ("EG", "Egypt", ("ar", "en"), "Egyptian Environmental Affairs Agency", "Africa", True),
    ("NG", "Nigeria", ("en", "ha", "yo"), "NESREA / Lagos State EPA", "Africa"),
    ("CD", "DR Congo", ("fr", "ln"), "Ministry of Environment and Sustainable Development", "Africa"),
    ("AO", "Angola", ("pt",), "Ministry of Environment", "Africa"),
    ("ZA", "South Africa", ("en", "zu", "af"), "Department of Forestry, Fisheries and the Environment", "Africa", True),
    ("KE", "Kenya", ("en", "sw"), "National Environment Management Authority (NEMA)", "Africa"),
    ("ET", "Ethiopia", ("am", "en"), "Environmental Protection Authority", "Africa", True),
    ("TZ", "Tanzania", ("sw", "en"), "National Environment Management Council", "Africa"),
    ("UG", "Uganda", ("en", "sw"), "National Environment Management Authority", "Africa"),
    ("RW", "Rwanda", ("rw", "en", "fr"), "Rwanda Environment Management Authority", "Africa"),
    ("GH", "Ghana", ("en", "ak"), "Environmental Protection Agency Ghana", "Africa"),
    ("CI", "Côte d'Ivoire", ("fr",), "Centre Ivoirien Antipollution (CIAPOL)", "Africa"),
    ("SN", "Senegal", ("fr", "wo"), "Centre de Gestion de la Qualité de l'Air (CGQA)", "Africa"),
    ("ML", "Mali", ("fr", "bm"), "Agence de l'Environnement et du Développement Durable", "Africa"),
    ("NE", "Niger", ("fr", "ha"), "Ministry of Environment", "Africa"),
    ("TD", "Chad", ("fr", "ar"), "Ministry of Environment", "Africa"),
    ("SD", "Sudan", ("ar", "en"), "Higher Council for Environment and Natural Resources", "Africa"),
    ("MA", "Morocco", ("ar", "fr"), "Ministry of Energy Transition and Sustainable Development", "Africa"),
    ("DZ", "Algeria", ("ar", "fr"), "Ministry of Environment", "Africa"),
    ("TN", "Tunisia", ("ar", "fr"), "Agence Nationale de Protection de l'Environnement", "Africa"),
    ("MZ", "Mozambique", ("pt",), "Ministry of Land and Environment", "Africa"),
    ("ZW", "Zimbabwe", ("en", "sn"), "Environmental Management Agency", "Africa"),
    ("ZM", "Zambia", ("en",), "Zambia Environmental Management Agency", "Africa"),
    ("MG", "Madagascar", ("mg", "fr"), "Ministry of Environment and Sustainable Development", "Africa"),
    # --- Americas ---
    ("US", "United States", ("en", "es"), "US EPA / state air agencies", "North America"),
    ("CA", "Canada", ("en", "fr"), "Environment and Climate Change Canada", "North America"),
    ("MX", "Mexico", ("es",), "SEMARNAT / SEDEMA", "North America"),
    ("GT", "Guatemala", ("es",), "Ministry of Environment and Natural Resources", "Latin America"),
    ("CU", "Cuba", ("es",), "Ministry of Science, Technology and Environment", "Latin America"),
    ("CO", "Colombia", ("es",), "IDEAM / Secretaría Distrital de Ambiente", "Latin America"),
    ("PE", "Peru", ("es", "qu"), "Ministerio del Ambiente / SENAMHI", "Latin America"),
    ("EC", "Ecuador", ("es",), "Ministry of Environment, Water and Ecological Transition", "Latin America"),
    ("VE", "Venezuela", ("es",), "Ministry of Ecosocialism", "Latin America"),
    ("CL", "Chile", ("es",), "Ministerio del Medio Ambiente (SINCA)", "Latin America"),
    ("AR", "Argentina", ("es",), "Ministry of Environment / APRA Buenos Aires", "Latin America"),
    ("BR", "Brazil", ("pt",), "IBAMA / CETESB (São Paulo)", "Latin America", True),
    ("BO", "Bolivia", ("es", "qu", "ay"), "Ministry of Environment and Water", "Latin America"),
    ("PY", "Paraguay", ("es", "gn"), "Ministry of Environment and Sustainable Development", "Latin America"),
    ("UY", "Uruguay", ("es",), "Ministry of Environment", "Latin America"),
    # --- Oceania ---
    ("AU", "Australia", ("en",), "State EPAs (NSW EPA, EPA Victoria, …)", "Oceania"),
    ("NZ", "New Zealand", ("en", "mi"), "Ministry for the Environment / regional councils", "Oceania"),
    ("PG", "Papua New Guinea", ("en", "tpi"), "Conservation and Environment Protection Authority", "Oceania"),
]
COUNTRIES: dict[str, Country] = {c[0]: Country(*c) for c in _C}

# Apportionment prior families for cities outside India
REGION_PROFILE = {
    "South Asia": "igp_metro", "Central Asia": "arid_metro", "East Asia": "industrial_metro",
    "South-East Asia": "sea_metro", "Middle East": "arid_metro", "Europe": "western_metro",
    "Africa": "african_metro", "North America": "western_metro", "Latin America": "latam_metro",
    "Oceania": "western_metro",
}
EXTRA_PROFILES = {
    "western_metro": {"transport": 0.32, "industry": 0.18, "residential": 0.20, "construction": 0.08, "dust": 0.12, "biomass": 0.10},
    "latam_metro":   {"transport": 0.34, "industry": 0.18, "residential": 0.10, "construction": 0.10, "dust": 0.16, "biomass": 0.12},
    "sea_metro":     {"transport": 0.30, "industry": 0.18, "residential": 0.12, "construction": 0.10, "dust": 0.10, "biomass": 0.20},
    "african_metro": {"transport": 0.22, "industry": 0.10, "residential": 0.28, "construction": 0.08, "dust": 0.24, "biomass": 0.08},
}

# (id, name, country, lat, lon, metro population in millions, federated truth site?)
_W = [
    # East Asia
    ("beijing", "Beijing", "CN", 39.9042, 116.4074, 21.9, True), ("shanghai", "Shanghai", "CN", 31.2304, 121.4737, 29.2, False),
    ("guangzhou", "Guangzhou", "CN", 23.1291, 113.2644, 14.0, False), ("shenzhen", "Shenzhen", "CN", 22.5431, 114.0579, 13.4, False),
    ("chengdu", "Chengdu", "CN", 30.5728, 104.0668, 16.3, False), ("chongqing", "Chongqing", "CN", 29.5630, 106.5516, 17.3, False),
    ("wuhan", "Wuhan", "CN", 30.5928, 114.3055, 11.1, False), ("xian", "Xi'an", "CN", 34.3416, 108.9398, 12.9, False),
    ("tianjin", "Tianjin", "CN", 39.3434, 117.3616, 13.9, False), ("shijiazhuang", "Shijiazhuang", "CN", 38.0428, 114.5149, 11.2, False),
    ("zhengzhou", "Zhengzhou", "CN", 34.7466, 113.6254, 12.6, False), ("harbin", "Harbin", "CN", 45.8038, 126.5349, 10.0, False),
    ("urumqi", "Ürümqi", "CN", 43.8256, 87.6168, 4.1, False), ("hongkong", "Hong Kong", "HK", 22.3193, 114.1694, 7.5, False),
    ("taipei", "Taipei", "TW", 25.0330, 121.5654, 7.0, False), ("seoul", "Seoul", "KR", 37.5665, 126.9780, 25.5, True),
    ("busan", "Busan", "KR", 35.1796, 129.0756, 3.4, False), ("tokyo", "Tokyo", "JP", 35.6762, 139.6503, 37.2, True),
    ("osaka", "Osaka", "JP", 34.6937, 135.5023, 19.0, False), ("ulaanbaatar", "Ulaanbaatar", "MN", 47.8864, 106.9057, 1.6, False),
    # South-East Asia
    ("bangkok", "Bangkok", "TH", 13.7563, 100.5018, 11.2, True), ("chiangmai", "Chiang Mai", "TH", 18.7883, 98.9853, 1.2, False),
    ("hanoi", "Hanoi", "VN", 21.0278, 105.8342, 8.4, False), ("hochiminh", "Ho Chi Minh City", "VN", 10.8231, 106.6297, 9.3, False),
    ("jakarta", "Jakarta", "ID", -6.2088, 106.8456, 34.5, True), ("surabaya", "Surabaya", "ID", -7.2575, 112.7521, 9.0, False),
    ("palembang", "Palembang", "ID", -2.9761, 104.7754, 1.7, False), ("pekanbaru", "Pekanbaru", "ID", 0.5071, 101.4478, 1.1, False),
    ("kualalumpur", "Kuala Lumpur", "MY", 3.1390, 101.6869, 8.6, False), ("singapore", "Singapore", "SG", 1.3521, 103.8198, 5.9, False),
    ("manila", "Manila", "PH", 14.5995, 120.9842, 24.9, False), ("yangon", "Yangon", "MM", 16.8409, 96.1735, 5.6, False),
    ("phnompenh", "Phnom Penh", "KH", 11.5564, 104.9282, 2.3, False), ("vientiane", "Vientiane", "LA", 17.9757, 102.6331, 0.9, False),
    # South & Central Asia (outside India)
    ("dhaka", "Dhaka", "BD", 23.8103, 90.4125, 23.9, True), ("chittagong", "Chattogram", "BD", 22.3569, 91.7832, 5.4, False),
    ("karachi", "Karachi", "PK", 24.8607, 67.0011, 17.2, False), ("lahore", "Lahore", "PK", 31.5204, 74.3587, 13.9, True),
    ("faisalabad", "Faisalabad", "PK", 31.4504, 73.1350, 3.6, False), ("peshawar", "Peshawar", "PK", 34.0151, 71.5249, 2.3, False),
    ("islamabad", "Islamabad", "PK", 33.6844, 73.0479, 1.2, False), ("kathmandu", "Kathmandu", "NP", 27.7172, 85.3240, 1.5, False),
    ("colombo", "Colombo", "LK", 6.9271, 79.8612, 5.6, False), ("kabul", "Kabul", "AF", 34.5553, 69.2075, 4.6, False),
    ("tashkent", "Tashkent", "UZ", 41.2995, 69.2401, 2.9, False), ("almaty", "Almaty", "KZ", 43.2220, 76.8512, 2.2, False),
    ("bishkek", "Bishkek", "KG", 42.8746, 74.5698, 1.1, False),
    # Middle East
    ("tehran", "Tehran", "IR", 35.6892, 51.3890, 9.4, False), ("isfahan", "Isfahan", "IR", 32.6546, 51.6680, 2.2, False),
    ("ahvaz", "Ahvaz", "IR", 31.3183, 48.6706, 1.3, False), ("baghdad", "Baghdad", "IQ", 33.3152, 44.3661, 7.5, False),
    ("basra", "Basra", "IQ", 30.5085, 47.7804, 1.4, False), ("riyadh", "Riyadh", "SA", 24.7136, 46.6753, 7.7, True),
    ("jeddah", "Jeddah", "SA", 21.4858, 39.1925, 4.7, False), ("dubai", "Dubai", "AE", 25.2048, 55.2708, 3.6, False),
    ("abudhabi", "Abu Dhabi", "AE", 24.4539, 54.3773, 1.5, False), ("doha", "Doha", "QA", 25.2854, 51.5310, 2.4, False),
    ("kuwaitcity", "Kuwait City", "KW", 29.3759, 47.9774, 3.1, False), ("muscat", "Muscat", "OM", 23.5880, 58.3829, 1.6, False),
    ("istanbul", "Istanbul", "TR", 41.0082, 28.9784, 15.8, True), ("ankara", "Ankara", "TR", 39.9334, 32.8597, 5.8, False),
    ("telaviv", "Tel Aviv", "IL", 32.0853, 34.7818, 4.2, False), ("amman", "Amman", "JO", 31.9454, 35.9284, 4.3, False),
    ("beirut", "Beirut", "LB", 33.8938, 35.5018, 2.4, False),
    # Europe
    ("london", "London", "GB", 51.5074, -0.1278, 9.6, True), ("manchester", "Manchester", "GB", 53.4808, -2.2426, 2.9, False),
    ("paris", "Paris", "FR", 48.8566, 2.3522, 11.2, True), ("lyon", "Lyon", "FR", 45.7640, 4.8357, 2.3, False),
    ("berlin", "Berlin", "DE", 52.5200, 13.4050, 3.8, True), ("munich", "Munich", "DE", 48.1351, 11.5820, 2.6, False),
    ("essen", "Ruhr (Essen)", "DE", 51.4556, 7.0116, 5.1, False), ("madrid", "Madrid", "ES", 40.4168, -3.7038, 6.8, True),
    ("barcelona", "Barcelona", "ES", 41.3874, 2.1686, 5.7, False), ("rome", "Rome", "IT", 41.9028, 12.4964, 4.3, False),
    ("milan", "Milan", "IT", 45.4642, 9.1900, 5.3, True), ("naples", "Naples", "IT", 40.8518, 14.2681, 3.1, False),
    ("amsterdam", "Amsterdam", "NL", 52.3676, 4.9041, 2.5, False), ("brussels", "Brussels", "BE", 50.8503, 4.3517, 2.1, False),
    ("vienna", "Vienna", "AT", 48.2082, 16.3738, 2.0, False), ("zurich", "Zürich", "CH", 47.3769, 8.5417, 1.4, False),
    ("warsaw", "Warsaw", "PL", 52.2297, 21.0122, 3.1, True), ("krakow", "Kraków", "PL", 50.0647, 19.9450, 1.4, False),
    ("katowice", "Katowice", "PL", 50.2649, 19.0238, 2.2, False), ("prague", "Prague", "CZ", 50.0755, 14.4378, 2.7, False),
    ("budapest", "Budapest", "HU", 47.4979, 19.0402, 3.0, False), ("bucharest", "Bucharest", "RO", 44.4268, 26.1025, 2.3, False),
    ("sofia", "Sofia", "BG", 42.6977, 23.3219, 1.3, False), ("belgrade", "Belgrade", "RS", 44.7866, 20.4489, 1.7, False),
    ("sarajevo", "Sarajevo", "BA", 43.8563, 18.4131, 0.6, False), ("skopje", "Skopje", "MK", 41.9981, 21.4254, 0.6, False),
    ("athens", "Athens", "GR", 37.9838, 23.7275, 3.2, False), ("lisbon", "Lisbon", "PT", 38.7223, -9.1393, 2.9, False),
    ("dublin", "Dublin", "IE", 53.3498, -6.2603, 1.4, False), ("stockholm", "Stockholm", "SE", 59.3293, 18.0686, 2.4, False),
    ("oslo", "Oslo", "NO", 59.9139, 10.7522, 1.1, False), ("copenhagen", "Copenhagen", "DK", 55.6761, 12.5683, 2.1, False),
    ("helsinki", "Helsinki", "FI", 60.1699, 24.9384, 1.3, False), ("kyiv", "Kyiv", "UA", 50.4501, 30.5234, 3.0, False),
    ("minsk", "Minsk", "BY", 53.9006, 27.5590, 2.0, False), ("moscow", "Moscow", "RU", 55.7558, 37.6173, 12.6, True),
    ("stpetersburg", "Saint Petersburg", "RU", 59.9311, 30.3609, 5.4, False), ("yekaterinburg", "Yekaterinburg", "RU", 56.8389, 60.6057, 1.5, False),
    ("novosibirsk", "Novosibirsk", "RU", 55.0084, 82.9357, 1.6, False), ("krasnoyarsk", "Krasnoyarsk", "RU", 56.0153, 92.8932, 1.2, False),
    # Africa
    ("cairo", "Cairo", "EG", 30.0444, 31.2357, 21.3, True), ("alexandria", "Alexandria", "EG", 31.2001, 29.9187, 5.4, False),
    ("lagos", "Lagos", "NG", 6.5244, 3.3792, 15.4, True), ("kano", "Kano", "NG", 12.0022, 8.5920, 4.1, False),
    ("abuja", "Abuja", "NG", 9.0765, 7.3986, 3.6, False), ("kinshasa", "Kinshasa", "CD", -4.4419, 15.2663, 16.3, False),
    ("luanda", "Luanda", "AO", -8.8390, 13.2894, 9.0, False), ("johannesburg", "Johannesburg", "ZA", -26.2041, 28.0473, 6.2, True),
    ("pretoria", "Pretoria", "ZA", -25.7479, 28.2293, 2.8, False), ("capetown", "Cape Town", "ZA", -33.9249, 18.4241, 4.8, False),
    ("durban", "Durban", "ZA", -29.8587, 31.0218, 3.9, False), ("nairobi", "Nairobi", "KE", -1.2921, 36.8219, 5.1, True),
    ("addisababa", "Addis Ababa", "ET", 8.9806, 38.7578, 5.5, False), ("daressalaam", "Dar es Salaam", "TZ", -6.7924, 39.2083, 7.4, False),
    ("kampala", "Kampala", "UG", 0.3476, 32.5825, 3.7, False), ("kigali", "Kigali", "RW", -1.9441, 30.0619, 1.2, False),
    ("accra", "Accra", "GH", 5.6037, -0.1870, 2.6, False), ("abidjan", "Abidjan", "CI", 5.3600, -4.0083, 5.6, False),
    ("dakar", "Dakar", "SN", 14.7167, -17.4677, 3.3, False), ("bamako", "Bamako", "ML", 12.6392, -8.0029, 2.8, False),
    ("niamey", "Niamey", "NE", 13.5116, 2.1254, 1.4, False), ("ndjamena", "N'Djamena", "TD", 12.1348, 15.0557, 1.6, False),
    ("khartoum", "Khartoum", "SD", 15.5007, 32.5599, 6.2, False), ("casablanca", "Casablanca", "MA", 33.5731, -7.5898, 3.8, False),
    ("algiers", "Algiers", "DZ", 36.7538, 3.0588, 2.9, False), ("tunis", "Tunis", "TN", 36.8065, 10.1815, 2.4, False),
    ("maputo", "Maputo", "MZ", -25.9692, 32.5732, 1.2, False), ("harare", "Harare", "ZW", -17.8252, 31.0335, 1.6, False),
    ("lusaka", "Lusaka", "ZM", -15.3875, 28.3228, 3.0, False), ("antananarivo", "Antananarivo", "MG", -18.8792, 47.5079, 3.9, False),
    # North America
    ("newyork", "New York", "US", 40.7128, -74.0060, 19.5, True), ("losangeles", "Los Angeles", "US", 34.0522, -118.2437, 12.5, True),
    ("chicago", "Chicago", "US", 41.8781, -87.6298, 9.4, False), ("houston", "Houston", "US", 29.7604, -95.3698, 7.1, False),
    ("phoenix", "Phoenix", "US", 33.4484, -112.0740, 4.9, False), ("sanfrancisco", "San Francisco", "US", 37.7749, -122.4194, 4.6, False),
    ("seattle", "Seattle", "US", 47.6062, -122.3321, 4.0, False), ("denver", "Denver", "US", 39.7392, -104.9903, 2.9, False),
    ("atlanta", "Atlanta", "US", 33.7490, -84.3880, 6.1, False), ("miami", "Miami", "US", 25.7617, -80.1918, 6.1, False),
    ("washington", "Washington, D.C.", "US", 38.9072, -77.0369, 6.3, False), ("saltlakecity", "Salt Lake City", "US", 40.7608, -111.8910, 1.3, False),
    ("fresno", "Fresno", "US", 36.7378, -119.7871, 1.0, False), ("toronto", "Toronto", "CA", 43.6532, -79.3832, 6.4, True),
    ("montreal", "Montréal", "CA", 45.5017, -73.5673, 4.3, False), ("vancouver", "Vancouver", "CA", 49.2827, -123.1207, 2.6, False),
    ("calgary", "Calgary", "CA", 51.0447, -114.0719, 1.5, False), ("mexicocity", "Mexico City", "MX", 19.4326, -99.1332, 22.3, True),
    ("guadalajara", "Guadalajara", "MX", 20.6597, -103.3496, 5.3, False), ("monterrey", "Monterrey", "MX", 25.6866, -100.3161, 5.3, False),
    # Latin America
    ("guatemalacity", "Guatemala City", "GT", 14.6349, -90.5069, 3.0, False), ("havana", "Havana", "CU", 23.1136, -82.3666, 2.1, False),
    ("bogota", "Bogotá", "CO", 4.7110, -74.0721, 11.3, True), ("medellin", "Medellín", "CO", 6.2442, -75.5812, 4.0, False),
    ("lima", "Lima", "PE", -12.0464, -77.0428, 11.0, True), ("quito", "Quito", "EC", -0.1807, -78.4678, 2.0, False),
    ("caracas", "Caracas", "VE", 10.4806, -66.9036, 2.9, False), ("santiago", "Santiago", "CL", -33.4489, -70.6693, 6.9, True),
    ("buenosaires", "Buenos Aires", "AR", -34.6037, -58.3816, 15.5, False), ("saopaulo", "São Paulo", "BR", -23.5505, -46.6333, 22.6, True),
    ("riodejaneiro", "Rio de Janeiro", "BR", -22.9068, -43.1729, 13.7, False), ("brasilia", "Brasília", "BR", -15.8267, -47.9218, 4.8, False),
    ("manaus", "Manaus", "BR", -3.1190, -60.0217, 2.3, False), ("portovelho", "Porto Velho", "BR", -8.7612, -63.9004, 0.5, False),
    ("cuiaba", "Cuiabá", "BR", -15.6014, -56.0979, 0.9, False), ("belohorizonte", "Belo Horizonte", "BR", -19.9167, -43.9345, 6.1, False),
    ("lapaz", "La Paz", "BO", -16.4897, -68.1193, 1.9, False), ("santacruz", "Santa Cruz de la Sierra", "BO", -17.8146, -63.1561, 1.8, False),
    ("asuncion", "Asunción", "PY", -25.2637, -57.5759, 3.4, False), ("montevideo", "Montevideo", "UY", -34.9011, -56.1645, 1.8, False),
    # Oceania
    ("sydney", "Sydney", "AU", -33.8688, 151.2093, 5.4, True), ("melbourne", "Melbourne", "AU", -37.8136, 144.9631, 5.2, False),
    ("brisbane", "Brisbane", "AU", -27.4698, 153.0251, 2.6, False), ("perth", "Perth", "AU", -31.9505, 115.8605, 2.2, False),
    ("auckland", "Auckland", "NZ", -36.8485, 174.7633, 1.7, False), ("portmoresby", "Port Moresby", "PG", -9.4438, 147.1803, 0.4, False),
]

WORLD_CITY_ROWS = _W
