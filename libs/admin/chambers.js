/* global Chambers */
// @ts-nocheck
/* global Chambers, Meteor */
Meteor.methods({
    'admin.chambers.fetchChambersJson': async function () {

        return [

        // New Foundland and Labrador
        { "code": 10001, "name": "Avalon", "province": "newfoundland and labrador" },
        { "code": 10002, "name": "Cape Spear", "province": "newfoundland and labrador" },
        { "code": 10003, "name": "Central Newfoundland", "province": "newfoundland and labrador" },
        { "code": 10004, "name": "Labrador", "province": "newfoundland and labrador" },
        { "code": 10005, "name": "Long Range Mountains", "province": "newfoundland and labrador" },
        { "code": 10006, "name": "St. John's East", "province": "newfoundland and labrador" },
        { "code": 10007, "name": "Terra Nova—The Peninsulas", "province": "newfoundland and labrador" },

        // Prince Edward Island
        { "code": 11001, "name": "Cardigan", "province": "prince edward island" },
        { "code": 11002, "name": "Charlottetown", "province": "prince edward island" },
        { "code": 11003, "name": "Egmont", "province": "prince edward island" },
        { "code": 11004, "name": "Malpeque", "province": "prince edward island" },

        // Nova Scotia
        { "code": 12001, "name": "Acadie—Annapolis", "province": "nova scotia" },
        { "code": 12002, "name": "Cape Breton—Canso—Antigonish", "province": "nova scotia" },
        { "code": 12003, "name": "Central Nova", "province": "nova scotia" },
        { "code": 12004, "name": "Cumberland—Colchester", "province": "nova scotia" },
        { "code": 12005, "name": "Dartmouth—Cole Harbour", "province": "nova scotia" },
        { "code": 12006, "name": "Halifax", "province": "nova scotia" },
        { "code": 12007, "name": "Halifax West", "province": "nova scotia" },
        { "code": 12008, "name": "Kings—Hants", "province": "nova scotia" },
        { "code": 12009, "name": "Sackville—Bedford—Preston", "province": "nova scotia" },
        { "code": 12010, "name": "South Shore—St. Margarets", "province": "nova scotia" },
        { "code": 12011, "name": "Sydney—Glace Bay", "province": "nova scotia" },

        // New Brunswick
        { "code": 13001, "name": "Acadie—Bathurst", "province": "new brunswick" },
        { "code": 13002, "name": "Beauséjour", "province": "new brunswick" },
        { "code": 13003, "name": "Fredericton—Oromocto", "province": "new brunswick" },
        { "code": 13004, "name": "Fundy Royal", "province": "new brunswick" },
        { "code": 13005, "name": "Madawaska—Restigouche", "province": "new brunswick" },
        { "code": 13006, "name": "Miramichi—Grand Lake", "province": "new brunswick" },
        { "code": 13007, "name": "Moncton—Dieppe", "province": "new brunswick" },
        { "code": 13008, "name": "Saint John—Kennebecasis", "province": "new brunswick" },
        { "code": 13009, "name": "Saint John—St. Croix", "province": "new brunswick" },
        { "code": 13010, "name": "Tobique—Mactaquac", "province": "new brunswick" },

        // Quebec
        { "code": 24001, "name": "Abitibi—Baie-James—Nunavik—Eeyou", "province": "quebec" },
        { "code": 24002, "name": "Abitibi—Témiscamingue", "province": "quebec" },
        { "code": 24003, "name": "Ahuntsic-Cartierville", "province": "quebec" },
        { "code": 24004, "name": "Alfred-Pellan", "province": "quebec" },
        { "code": 24005, "name": "Argenteuil—La Petite-Nation", "province": "quebec" },
        { "code": 24006, "name": "Beauce", "province": "quebec" },
        { "code": 24007, "name": "Beauharnois—Salaberry—Soulanges—Huntingdon", "province": "quebec" },
        { "code": 24008, "name": "Beauport—Limoilou", "province": "quebec" },
        { "code": 24009, "name": "Bécancour—Nicolet—Saurel—Alnôbak", "province": "quebec" },
        { "code": 24010, "name": "Bellechasse—Les Etchemins—Lévis", "province": "quebec" },
        { "code": 24011, "name": "Beloeil—Chambly", "province": "quebec" },
        { "code": 24012, "name": "Berthier—Maskinongé", "province": "quebec" },
        { "code": 24013, "name": "Bourassa", "province": "quebec" },
        { "code": 24014, "name": "Brome—Missisquoi", "province": "quebec" },
        { "code": 24015, "name": "Brossard—Saint-Lambert", "province": "quebec" },
        { "code": 24016, "name": "Charlesbourg—Haute-Saint-Charles", "province": "quebec" },
        { "code": 24017, "name": "Châteauguay—Les Jardins-de-Napierville", "province": "quebec" },
        { "code": 24018, "name": "Chicoutimi—Le Fjord", "province": "quebec" },
        { "code": 24019, "name": "Compton—Stanstead", "province": "quebec" },
        { "code": 24020, "name": "Côte-du-Sud—Rivière-du-Loup—Kataskomiq—Témiscouata", "province": "quebec" },
        { "code": 24021, "name": "Côte-Nord—Kawawachikamach—Nitassinan", "province": "quebec" },
        { "code": 24022, "name": "Dorval—Lachine—LaSalle", "province": "quebec" },
        { "code": 24023, "name": "Drummond", "province": "quebec" },
        { "code": 24024, "name": "Gaspésie—Les Îles-de-la-Madeleine—Listuguj", "province": "quebec" },
        { "code": 24025, "name": "Gatineau", "province": "quebec" },
        { "code": 24026, "name": "Hochelaga—Rosemont-Est", "province": "quebec" },
        { "code": 24027, "name": "Honoré-Mercier", "province": "quebec" },
        { "code": 24028, "name": "Hull—Aylmer", "province": "quebec" },
        { "code": 24029, "name": "Joliette—Manawan", "province": "quebec" },
        { "code": 24030, "name": "Jonquière", "province": "quebec" },
        { "code": 24031, "name": "La Pointe-de-l'Île", "province": "quebec" },
        { "code": 24032, "name": "La Prairie—Atateken", "province": "quebec" },
        { "code": 24033, "name": "Lac-Saint-Jean", "province": "quebec" },
        { "code": 24034, "name": "Lac-Saint-Louis", "province": "quebec" },
        { "code": 24035, "name": "LaSalle—Émard—Verdun", "province": "quebec" },
        { "code": 24036, "name": "Laurentides—Labelle", "province": "quebec" },
        { "code": 24037, "name": "Laurier—Sainte-Marie", "province": "quebec" },
        { "code": 24038, "name": "Laval—Les Îles", "province": "quebec" },
        { "code": 24039, "name": "Les Pays-d'en-Haut", "province": "quebec" },
        { "code": 24040, "name": "Lévis—Lotbinière", "province": "quebec" },
        { "code": 24041, "name": "Longueuil—Charles-LeMoyne", "province": "quebec" },
        { "code": 24042, "name": "Longueuil—Saint-Hubert", "province": "quebec" },
        { "code": 24043, "name": "Louis-Hébert", "province": "quebec" },
        { "code": 24044, "name": "Louis-Saint-Laurent—Akiawenhrahk", "province": "quebec" },
        { "code": 24045, "name": "Marc-Aurèle-Fortin", "province": "quebec" },
        { "code": 24046, "name": "Mégantic—L'Érable—Lotbinière", "province": "quebec" },
        { "code": 24047, "name": "Mirabel", "province": "quebec" },
        { "code": 24048, "name": "Mount Royal", "province": "quebec" },
        { "code": 24049, "name": "Mont-Saint-Bruno—L'Acadie", "province": "quebec" },
        { "code": 24050, "name": "Montcalm", "province": "quebec" },
        { "code": 24051, "name": "Montmorency—Charlevoix", "province": "quebec" },
        { "code": 24052, "name": "Notre-Dame-de-Grâce—Westmount", "province": "quebec" },
        { "code": 24053, "name": "Outremont", "province": "quebec" },
        { "code": 24054, "name": "Papineau", "province": "quebec" },
        { "code": 24055, "name": "Pierre-Boucher—Les Patriotes—Verchères", "province": "quebec" },
        { "code": 24056, "name": "Pierrefonds—Dollard", "province": "quebec" },
        { "code": 24057, "name": "Pontiac—Kitigan Zibi", "province": "quebec" },
        { "code": 24058, "name": "Portneuf—Jacques-Cartier", "province": "quebec" },
        { "code": 24059, "name": "Québec Centre", "province": "quebec" },
        { "code": 24060, "name": "Repentigny", "province": "quebec" },
        { "code": 24061, "name": "Richmond—Arthabaska", "province": "quebec" },
        { "code": 24062, "name": "Rimouski—La Matapédia", "province": "quebec" },
        { "code": 24063, "name": "Rivière-des-Mille-Îles", "province": "quebec" },
        { "code": 24064, "name": "Rivière-du-Nord", "province": "quebec" },
        { "code": 24065, "name": "Rosemont—La Petite-Patrie", "province": "quebec" },
        { "code": 24066, "name": "Saint-Hyacinthe—Bagot—Acton", "province": "quebec" },
        { "code": 24067, "name": "Saint-Jean", "province": "quebec" },
        { "code": 24068, "name": "Saint-Laurent", "province": "quebec" },
        { "code": 24069, "name": "Saint-Léonard—Saint-Michel", "province": "quebec" },
        { "code": 24070, "name": "Saint-Maurice—Champlain", "province": "quebec" },
        { "code": 24071, "name": "Shefford", "province": "quebec" },
        { "code": 24072, "name": "Sherbrooke", "province": "quebec" },
        { "code": 24073, "name": "Terrebonne", "province": "quebec" },
        { "code": 24074, "name": "Thérèse-De Blainville", "province": "quebec" },
        { "code": 24075, "name": "Trois-Rivières", "province": "quebec" },
        { "code": 24076, "name": "Vaudreuil", "province": "quebec" },
        { "code": 24077, "name": "Ville-Marie—Le Sud-Ouest—Île-des-Sœurs", "province": "quebec" },
        { "code": 24078, "name": "Vimy", "province": "quebec" },

        // Ontario
        { "code": 35001, "name": "Ajax", "province": "ontario" },
        { "code": 35002, "name": "Algonquin—Renfrew—Pembroke", "province": "ontario" },
        { "code": 35003, "name": "Aurora—Oak Ridges—Richmond Hill", "province": "ontario" },
        { "code": 35004, "name": "Barrie South—Innisfil", "province": "ontario" },
        { "code": 35005, "name": "Barrie—Springwater—Oro-Medonte", "province": "ontario" },
        { "code": 35006, "name": "Bay of Quinte", "province": "ontario" },
        { "code": 35007, "name": "Beaches—East York", "province": "ontario" },
        { "code": 35008, "name": "Bowmanville—Oshawa North", "province": "ontario" },
        { "code": 35009, "name": "Brampton Centre", "province": "ontario" },
        { "code": 35010, "name": "Brampton—Chinguacousy Park", "province": "ontario" },
        { "code": 35011, "name": "Brampton East", "province": "ontario" },
        { "code": 35012, "name": "Brampton North—Caledon", "province": "ontario" },
        { "code": 35013, "name": "Brampton South", "province": "ontario" },
        { "code": 35014, "name": "Brampton West", "province": "ontario" },
        { "code": 35015, "name": "Brantford—Brant South—Six Nations", "province": "ontario" },
        { "code": 35016, "name": "Bruce—Grey—Owen Sound", "province": "ontario" },
        { "code": 35017, "name": "Burlington", "province": "ontario" },
        { "code": 35018, "name": "Burlington North—Milton West", "province": "ontario" },
        { "code": 35019, "name": "Cambridge", "province": "ontario" },
        { "code": 35020, "name": "Carleton", "province": "ontario" },
        { "code": 35021, "name": "Chatham-Kent—Leamington", "province": "ontario" },
        { "code": 35022, "name": "Davenport", "province": "ontario" },
        { "code": 35023, "name": "Don Valley North", "province": "ontario" },
        { "code": 35024, "name": "Don Valley West", "province": "ontario" },
        { "code": 35025, "name": "Dufferin—Caledon", "province": "ontario" },
        { "code": 35026, "name": "Eglinton—Lawrence", "province": "ontario" },
        { "code": 35027, "name": "Elgin—St. Thomas—London South", "province": "ontario" },
        { "code": 35028, "name": "Essex", "province": "ontario" },
        { "code": 35029, "name": "Etobicoke Centre", "province": "ontario" },
        { "code": 35030, "name": "Etobicoke—Lakeshore", "province": "ontario" },
        { "code": 35031, "name": "Etobicoke North", "province": "ontario" },
        { "code": 35032, "name": "Flamborough—Glanbrook—Brant North", "province": "ontario" },
        { "code": 35033, "name": "Guelph", "province": "ontario" },
        { "code": 35034, "name": "Haldimand—Norfolk", "province": "ontario" },
        { "code": 35035, "name": "Haliburton—Kawartha Lakes", "province": "ontario" },
        { "code": 35036, "name": "Hamilton Centre", "province": "ontario" },
        { "code": 35037, "name": "Hamilton East—Stoney Creek", "province": "ontario" },
        { "code": 35038, "name": "Hamilton Mountain", "province": "ontario" },
        { "code": 35039, "name": "Hamilton West—Ancaster—Dundas", "province": "ontario" },
        { "code": 35040, "name": "Hastings—Lennox and Addington—Tyendinaga", "province": "ontario" },
        { "code": 35041, "name": "Humber River—Black Creek", "province": "ontario" },
        { "code": 35042, "name": "Huron—Bruce", "province": "ontario" },
        { "code": 35043, "name": "Kanata", "province": "ontario" },
        { "code": 35044, "name": "Kapuskasing—Timmins—Mushkegowuk", "province": "ontario" },
        { "code": 35045, "name": "Kenora—Kiiwetinoong", "province": "ontario" },
        { "code": 35046, "name": "Kingston and the Islands", "province": "ontario" },
        { "code": 35047, "name": "King—Vaughan", "province": "ontario" },
        { "code": 35048, "name": "Kitchener Centre", "province": "ontario" },
        { "code": 35049, "name": "Kitchener—Conestoga", "province": "ontario" },
        { "code": 35050, "name": "Kitchener South—Hespeler", "province": "ontario" },
        { "code": 35051, "name": "Lanark—Frontenac", "province": "ontario" },
        { "code": 35052, "name": "Leeds—Grenville—Thousand Islands—Rideau Lakes", "province": "ontario" },
        { "code": 35053, "name": "London Centre", "province": "ontario" },
        { "code": 35054, "name": "London—Fanshawe", "province": "ontario" },
        { "code": 35055, "name": "London West", "province": "ontario" },
        { "code": 35056, "name": "Markham—Stouffville", "province": "ontario" },
        { "code": 35057, "name": "Markham—Thornhill", "province": "ontario" },
        { "code": 35058, "name": "Markham—Unionville", "province": "ontario" },
        { "code": 35059, "name": "Middlesex—London", "province": "ontario" },
        { "code": 35060, "name": "Milton East—Halton Hills South", "province": "ontario" },
        { "code": 35061, "name": "Mississauga Centre", "province": "ontario" },
        { "code": 35062, "name": "Mississauga East—Cooksville", "province": "ontario" },
        { "code": 35063, "name": "Mississauga—Erin Mills", "province": "ontario" },
        { "code": 35064, "name": "Mississauga—Lakeshore", "province": "ontario" },
        { "code": 35065, "name": "Mississauga—Malton", "province": "ontario" },
        { "code": 35066, "name": "Mississauga—Streetsville", "province": "ontario" },
        { "code": 35067, "name": "Nepean", "province": "ontario" },
        { "code": 35068, "name": "Newmarket—Aurora", "province": "ontario" },
        { "code": 35069, "name": "New Tecumseth—Gwillimbury", "province": "ontario" },
        { "code": 35070, "name": "Niagara Falls—Niagara-on-the-Lake", "province": "ontario" },
        { "code": 35071, "name": "Niagara South", "province": "ontario" },
        { "code": 35072, "name": "Niagara West", "province": "ontario" },
        { "code": 35073, "name": "Nipissing—Timiskaming", "province": "ontario" },
        { "code": 35074, "name": "Northumberland—Clarke", "province": "ontario" },
        { "code": 35075, "name": "Oakville East", "province": "ontario" },
        { "code": 35076, "name": "Oakville West", "province": "ontario" },
        { "code": 35077, "name": "Orléans", "province": "ontario" },
        { "code": 35078, "name": "Oshawa", "province": "ontario" },
        { "code": 35079, "name": "Ottawa Centre", "province": "ontario" },
        { "code": 35080, "name": "Ottawa South", "province": "ontario" },
        { "code": 35081, "name": "Ottawa—Vanier—Gloucester", "province": "ontario" },
        { "code": 35082, "name": "Ottawa West—Nepean", "province": "ontario" },
        { "code": 35083, "name": "Oxford", "province": "ontario" },
        { "code": 35084, "name": "Parry Sound—Muskoka", "province": "ontario" },
        { "code": 35085, "name": "Perth—Wellington", "province": "ontario" },
        { "code": 35086, "name": "Peterborough", "province": "ontario" },
        { "code": 35087, "name": "Pickering—Brooklin", "province": "ontario" },
        { "code": 35088, "name": "Prescott—Russell—Cumberland", "province": "ontario" },
        { "code": 35089, "name": "Richmond Hill South", "province": "ontario" },
        { "code": 35090, "name": "Sarnia—Lambton—Bkejwanong", "province": "ontario" },
        { "code": 35091, "name": "Sault Ste. Marie—Algoma", "province": "ontario" },
        { "code": 35092, "name": "Scarborough—Agincourt", "province": "ontario" },
        { "code": 35093, "name": "Scarborough Centre—Don Valley East", "province": "ontario" },
        { "code": 35094, "name": "Scarborough—Guildwood—Rouge Park", "province": "ontario" },
        { "code": 35095, "name": "Scarborough North", "province": "ontario" },
        { "code": 35096, "name": "Scarborough Southwest", "province": "ontario" },
        { "code": 35097, "name": "Scarborough—Woburn", "province": "ontario" },
        { "code": 35098, "name": "Simcoe—Grey", "province": "ontario" },
        { "code": 35099, "name": "Simcoe North", "province": "ontario" },
        { "code": 35100, "name": "Spadina—Harbourfront", "province": "ontario" },
        { "code": 35101, "name": "St. Catharines", "province": "ontario" },
        { "code": 35102, "name": "Stormont—Dundas—Glengarry", "province": "ontario" },
        { "code": 35103, "name": "Sudbury", "province": "ontario" },
        { "code": 35104, "name": "Sudbury East—Manitoulin—Nickel Belt", "province": "ontario" },
        { "code": 35105, "name": "Taiaiako'n—Parkdale—High Park", "province": "ontario" },
        { "code": 35106, "name": "Thornhill", "province": "ontario" },
        { "code": 35107, "name": "Thunder Bay—Rainy River", "province": "ontario" },
        { "code": 35108, "name": "Thunder Bay—Superior North", "province": "ontario" },
        { "code": 35109, "name": "Toronto Centre", "province": "ontario" },
        { "code": 35110, "name": "Toronto—Danforth", "province": "ontario" },
        { "code": 35111, "name": "Toronto—St. Paul's", "province": "ontario" },
        { "code": 35112, "name": "University—Rosedale", "province": "ontario" },
        { "code": 35113, "name": "Vaughan—Woodbridge", "province": "ontario" },
        { "code": 35114, "name": "Waterloo", "province": "ontario" },
        { "code": 35115, "name": "Wellington—Halton Hills North", "province": "ontario" },
        { "code": 35116, "name": "Whitby", "province": "ontario" },
        { "code": 35117, "name": "Willowdale", "province": "ontario" },
        { "code": 35118, "name": "Windsor—Tecumseh—Lakeshore", "province": "ontario" },
        { "code": 35119, "name": "Windsor West", "province": "ontario" },
        { "code": 35120, "name": "York Centre", "province": "ontario" },
        { "code": 35121, "name": "York—Durham", "province": "ontario" },
        { "code": 35122, "name": "York South—Weston—Etobicoke", "province": "ontario" },

        // Manitoba
        { "code": 46001, "name": "Brandon—Souris", "province": "manitoba" },
        { "code": 46002, "name": "Churchill—Keewatinook Aski", "province": "manitoba" },
        { "code": 46003, "name": "Elmwood—Transcona", "province": "manitoba" },
        { "code": 46004, "name": "Kildonan—St. Paul", "province": "manitoba" },
        { "code": 46005, "name": "Portage—Lisgar", "province": "manitoba" },
        { "code": 46006, "name": "Provencher", "province": "manitoba" },
        { "code": 46007, "name": "Riding Mountain", "province": "manitoba" },
        { "code": 46008, "name": "St. Boniface—St. Vital", "province": "manitoba" },
        { "code": 46009, "name": "Selkirk—Interlake—Eastman", "province": "manitoba" },
        { "code": 46010, "name": "Winnipeg Centre", "province": "manitoba" },
        { "code": 46011, "name": "Winnipeg North", "province": "manitoba" },
        { "code": 46012, "name": "Winnipeg South", "province": "manitoba" },
        { "code": 46013, "name": "Winnipeg South Centre", "province": "manitoba" },
        { "code": 46014, "name": "Winnipeg West", "province": "manitoba" },

        // Saskatchewan
        { "code": 47001, "name": "Battlefords—Lloydminster—Meadow Lake", "province": "saskatchewan" },
        { "code": 47002, "name": "Carlton Trail—Eagle Creek", "province": "saskatchewan" },
        { "code": 47003, "name": "Desnethé—Missinippi—Churchill River", "province": "saskatchewan" },
        { "code": 47004, "name": "Moose Jaw—Lake Centre—Lanigan", "province": "saskatchewan" },
        { "code": 47005, "name": "Prince Albert", "province": "saskatchewan" },
        { "code": 47006, "name": "Regina—Lewvan", "province": "saskatchewan" },
        { "code": 47007, "name": "Regina—Qu'Appelle", "province": "saskatchewan" },
        { "code": 47008, "name": "Regina—Wascana", "province": "saskatchewan" },
        { "code": 47009, "name": "Saskatoon South", "province": "saskatchewan" },
        { "code": 47010, "name": "Saskatoon—University", "province": "saskatchewan" },
        { "code": 47011, "name": "Saskatoon West", "province": "saskatchewan" },
        { "code": 47012, "name": "Souris—Moose Mountain", "province": "saskatchewan" },
        { "code": 47013, "name": "Swift Current—Grasslands—Kindersley", "province": "saskatchewan" },
        { "code": 47014, "name": "Yorkton—Melville", "province": "saskatchewan" },

        // Alberta
        { "code": 48001, "name": "Airdrie—Cochrane", "province": "alberta" },
        { "code": 48002, "name": "Battle River—Crowfoot", "province": "alberta" },
        { "code": 48003, "name": "Bow River", "province": "alberta" },
        { "code": 48004, "name": "Calgary Centre", "province": "alberta" },
        { "code": 48005, "name": "Calgary Confederation", "province": "alberta" },
        { "code": 48006, "name": "Calgary Crowfoot", "province": "alberta" },
        { "code": 48007, "name": "Calgary East", "province": "alberta" },
        { "code": 48008, "name": "Calgary Heritage", "province": "alberta" },
        { "code": 48009, "name": "Calgary McKnight", "province": "alberta" },
        { "code": 48010, "name": "Calgary Midnapore", "province": "alberta" },
        { "code": 48011, "name": "Calgary Nose Hill", "province": "alberta" },
        { "code": 48012, "name": "Calgary Shepard", "province": "alberta" },
        { "code": 48013, "name": "Calgary Signal Hill", "province": "alberta" },
        { "code": 48014, "name": "Calgary Skyview", "province": "alberta" },
        { "code": 48015, "name": "Edmonton Centre", "province": "alberta" },
        { "code": 48016, "name": "Edmonton Gateway", "province": "alberta" },
        { "code": 48017, "name": "Edmonton Griesbach", "province": "alberta" },
        { "code": 48018, "name": "Edmonton Manning", "province": "alberta" },
        { "code": 48019, "name": "Edmonton Northwest", "province": "alberta" },
        { "code": 48020, "name": "Edmonton Riverbend", "province": "alberta" },
        { "code": 48021, "name": "Edmonton Southeast", "province": "alberta" },
        { "code": 48022, "name": "Edmonton Strathcona", "province": "alberta" },
        { "code": 48023, "name": "Edmonton West", "province": "alberta" },
        { "code": 48024, "name": "Foothills", "province": "alberta" },
        { "code": 48025, "name": "Fort McMurray—Cold Lake", "province": "alberta" },
        { "code": 48026, "name": "Grande Prairie", "province": "alberta" },
        { "code": 48027, "name": "Lakeland", "province": "alberta" },
        { "code": 48028, "name": "Leduc—Wetaskiwin", "province": "alberta" },
        { "code": 48029, "name": "Lethbridge", "province": "alberta" },
        { "code": 48030, "name": "Medicine Hat—Cardston—Warner", "province": "alberta" },
        { "code": 48031, "name": "Parkland", "province": "alberta" },
        { "code": 48032, "name": "Peace River—Westlock", "province": "alberta" },
        { "code": 48033, "name": "Ponoka—Didsbury", "province": "alberta" },
        { "code": 48034, "name": "Red Deer", "province": "alberta" },
        { "code": 48035, "name": "Sherwood Park—Fort Saskatchewan", "province": "alberta" },
        { "code": 48036, "name": "St. Albert—Sturgeon River", "province": "alberta" },
        { "code": 48037, "name": "Yellowhead", "province": "alberta" },

        // British Columbia
        { "code": 59001, "name": "Abbotsford—South Langley", "province": "british columbia" },
        { "code": 59002, "name": "Burnaby Central", "province": "british columbia" },
        { "code": 59003, "name": "Burnaby North—Seymour", "province": "british columbia" },
        { "code": 59004, "name": "Cariboo—Prince George", "province": "british columbia" },
        { "code": 59005, "name": "Chilliwack—Hope", "province": "british columbia" },
        { "code": 59006, "name": "Cloverdale—Langley City", "province": "british columbia" },
        { "code": 59007, "name": "Columbia—Kootenay—Southern Rockies", "province": "british columbia" },
        { "code": 59008, "name": "Coquitlam—Port Coquitlam", "province": "british columbia" },
        { "code": 59009, "name": "Courtenay—Alberni", "province": "british columbia" },
        { "code": 59010, "name": "Cowichan—Malahat—Langford", "province": "british columbia" },
        { "code": 59011, "name": "Delta", "province": "british columbia" },
        { "code": 59012, "name": "Esquimalt—Saanich—Sooke", "province": "british columbia" },
        { "code": 59013, "name": "Fleetwood—Port Kells", "province": "british columbia" },
        { "code": 59014, "name": "Kamloops—Shuswap—Central Rockies", "province": "british columbia" },
        { "code": 59015, "name": "Kamloops—Thompson—Nicola", "province": "british columbia" },
        { "code": 59016, "name": "Kelowna", "province": "british columbia" },
        { "code": 59017, "name": "Langley Township—Fraser Heights", "province": "british columbia" },
        { "code": 59018, "name": "Mission—Matsqui—Abbotsford", "province": "british columbia" },
        { "code": 59019, "name": "Nanaimo—Ladysmith", "province": "british columbia" },
        { "code": 59020, "name": "New Westminster—Burnaby—Maillardville", "province": "british columbia" },
        { "code": 59021, "name": "North Island—Powell River", "province": "british columbia" },
        { "code": 59022, "name": "North Vancouver—Capilano", "province": "british columbia" },
        { "code": 59023, "name": "Okanagan Lake West—South Kelowna", "province": "british columbia" },
        { "code": 59024, "name": "Pitt Meadows—Maple Ridge", "province": "british columbia" },
        { "code": 59025, "name": "Port Moody—Coquitlam", "province": "british columbia" },
        { "code": 59026, "name": "Prince George—Peace River—Northern Rockies", "province": "british columbia" },
        { "code": 59027, "name": "Richmond Centre—Marpole", "province": "british columbia" },
        { "code": 59028, "name": "Richmond East—Steveston", "province": "british columbia" },
        { "code": 59029, "name": "Saanich—Gulf Islands", "province": "british columbia" },
        { "code": 59030, "name": "Similkameen—South Okanagan—West Kootenay", "province": "british columbia" },
        { "code": 59031, "name": "Skeena—Bulkley Valley", "province": "british columbia" },
        { "code": 59032, "name": "South Surrey—White Rock", "province": "british columbia" },
        { "code": 59033, "name": "Surrey Centre", "province": "british columbia" },
        { "code": 59034, "name": "Surrey Newton", "province": "british columbia" },
        { "code": 59035, "name": "Vancouver Centre", "province": "british columbia" },
        { "code": 59036, "name": "Vancouver East", "province": "british columbia" },
        { "code": 59037, "name": "Vancouver Fraserview—South Burnaby", "province": "british columbia" },
        { "code": 59038, "name": "Vancouver Granville", "province": "british columbia" },
        { "code": 59039, "name": "Vancouver Kingsway", "province": "british columbia" },
        { "code": 59040, "name": "Vancouver Quadra", "province": "british columbia" },
        { "code": 59041, "name": "Vernon—Lake Country—Monashee", "province": "british columbia" },
        { "code": 59042, "name": "Victoria", "province": "british columbia" },
        { "code": 59043, "name": "West Vancouver—Sunshine Coast—Sea to Sky Country", "province": "british columbia" },

        // Yukon
        { "code": 60001, "name": "Yukon", "province": "yukon" },

        // Northwest Territories
        { "code": 61001, "name": "Northwest Territories", "province": "northwest territories" },

        // Nunavut
        { "code": 62001, "name": "Nunavut", "province": "nunavut" }

        ];

    },

    'admin.chambers.syncFromParliamentXml': async function () {
        // Ensure server-side execution
        if (!Meteor.isServer) {
            return false;
        }

        // Ensure the user is authorized
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }

        const { XMLParser } = require('fast-xml-parser');

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });

        try {
            // Fetch XML from Parliament website
            console.log('Fetching XML from Parliament...');
            const response = await fetch('https://www.ourcommons.ca/Members/en/constituencies/XML');
            if (!response.ok) {
                throw new Meteor.Error('fetch-failed', `Failed to fetch XML: ${response.status}`);
            }
            const xmlText = await response.text();
            console.log('XML Response length:', xmlText.length);
            console.log('XML Response preview:', xmlText.substring(0, 500));

            // Parse XML
            const parsedData = parser.parse(xmlText);
            console.log('Parsed data structure:', Object.keys(parsedData));

            // Extract unique constituencies
            const constituencies = new Map();

            // Try different possible structures
            let members = [];
            if (parsedData.ArrayOfConstituency && parsedData.ArrayOfConstituency.Constituency) {
                members = parsedData.ArrayOfConstituency.Constituency;
                console.log('Found constituencies in ArrayOfConstituency.Constituency');
            } else if (parsedData.ArrayOfMemberOfParliament && parsedData.ArrayOfMemberOfParliament.MemberOfParliament) {
                members = parsedData.ArrayOfMemberOfParliament.MemberOfParliament;
                console.log('Found members in ArrayOfMemberOfParliament.MemberOfParliament');
            } else if (parsedData.members) {
                members = parsedData.members;
                console.log('Found members in members');
            } else if (parsedData.MemberOfParliament) {
                members = Array.isArray(parsedData.MemberOfParliament) ? parsedData.MemberOfParliament : [parsedData.MemberOfParliament];
                console.log('Found members in MemberOfParliament');
            } else {
                console.log('Available keys in parsed data:', Object.keys(parsedData));
                // Try to find any array that might contain members
                for (const key of Object.keys(parsedData)) {
                    if (Array.isArray(parsedData[key]) && parsedData[key].length > 0) {
                        console.log(`Found array in key '${key}' with ${parsedData[key].length} items`);
                        if (parsedData[key][0] && (parsedData[key][0].ConstituencyName || parsedData[key][0].constituencyName || parsedData[key][0].Name)) {
                            members = parsedData[key];
                            console.log(`Using members from key '${key}'`);
                            break;
                        }
                    }
                }
            }

            console.log('Number of members found:', members.length);
            if (members.length > 0) {
                console.log('First member structure:', Object.keys(members[0]));
                console.log('First member data:', JSON.stringify(members[0], null, 2));
            }

            for (const member of members) {
                const constituencyName = member.Name || member.ConstituencyName || member.constituencyName;
                const provinceName = member.ProvinceTerritoryName || member.ConstituencyProvinceTerritoryName || member.ProvinceName || member.provinceName;

                // Add member info if available
                const currentMember = member.PersonId ? {
                    personId: member.PersonId,
                    firstName: member.CurrentPersonOfficialFirstName,
                    lastName: member.CurrentPersonOfficialLastName,
                    honorific: member.CurrentPersonShortHonorific,
                    caucus: member.CurrentCaucusShortName
                } : null;

                if (constituencyName && provinceName) {
                    const key = `${provinceName.toLowerCase()}-${constituencyName}`;
                    if (!constituencies.has(key)) {
                        constituencies.set(key, {
                            name: constituencyName,
                            province: provinceName.toLowerCase(),
                            currentMember: currentMember
                        });
                    }
                } else {
                    console.log('Missing data in member:', { constituencyName, provinceName, availableKeys: Object.keys(member) });
                }
            }

            // Convert to array format expected by buildChambers
            const chambersArray = Array.from(constituencies.values()).map((chamber) => ({
                name: chamber.name,
                province: chamber.province,
                currentMember: chamber.currentMember
            }));

            console.log(`ADMIN: XML Sync - Fetched ${chambersArray.length} unique constituencies from Parliament XML`);

            return chambersArray;

        } catch (error) {
            console.error('Error syncing from Parliament XML:', error);
            throw new Meteor.Error('sync-failed', 'Failed to sync chambers from Parliament XML');
        }
    },

    'admin.chambers.testXmlFetch': async function () {
        // Ensure server-side execution
        if (!Meteor.isServer) {
            return false;
        }

        try {
            console.log('Testing XML fetch from Parliament...');
            const response = await fetch('https://www.ourcommons.ca/Members/en/search/XML');
            if (!response.ok) {
                throw new Meteor.Error('fetch-failed', `Failed to fetch XML: ${response.status}`);
            }
            const xmlText = await response.text();
            console.log('XML Response length:', xmlText.length);
            console.log('XML Response preview (first 1000 chars):', xmlText.substring(0, 1000));

            // Try to find the structure
            const lines = xmlText.split('\n').slice(0, 20);
            console.log('First 20 lines of XML:');
            lines.forEach((line, i) => console.log(`${i + 1}: ${line}`));

            return { success: true, length: xmlText.length, preview: xmlText.substring(0, 500) };

        } catch (error) {
            console.error('Error testing XML fetch:', error);
            return { success: false, error: error.message };
        }
    },

    'admin.chambers.diffReport': async function () {
        // Ensure server-side execution
        if (!Meteor.isServer) {
            return false;
        }

        // Ensure the user is authorized
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }

        try {
            // Get current XML data
            const xmlChambers = await Meteor.call('admin.chambers.syncFromParliamentXml');

            // Get existing chambers
            const existingChambers = await Chambers.find({}, { fields: { code: 1, name: 1, province: 1 } }).fetchAsync();

            // Create maps for comparison
            const xmlMap = new Map();
            xmlChambers.forEach(chamber => {
                const key = `${chamber.province}-${chamber.name}`;
                xmlMap.set(key, chamber);
            });

            const existingMap = new Map();
            existingChambers.forEach(chamber => {
                const key = `${chamber.province}-${chamber.name}`;
                existingMap.set(key, chamber);
            });

            // Find differences
            const newChambers = [];
            const removedChambers = [];
            const updatedChambers = [];

            // Check XML against existing (new chambers)
            xmlMap.forEach((xmlChamber, key) => {
                if (!existingMap.has(key)) {
                    newChambers.push(xmlChamber);
                }
            });

            // Check existing against XML (removed chambers)
            existingMap.forEach((existingChamber, key) => {
                if (!xmlMap.has(key)) {
                    removedChambers.push(existingChamber);
                }
            });

            // For now, no updates detected since we're only comparing names/provinces
            // Could be enhanced to detect name changes if we store previous names

            return {
                totalXml: xmlChambers.length,
                totalExisting: existingChambers.length,
                newCount: newChambers.length,
                removedCount: removedChambers.length,
                updatedCount: updatedChambers.length,
                newChambers,
                removedChambers,
                updatedChambers
            };

        } catch (error) {
            console.error('Error generating diff report:', error);
            throw new Meteor.Error('diff-failed', 'Failed to generate diff report');
        }
    }

});

// Extend admin chambers methods with a fetch/update for federal members
Meteor.methods({
    'admin.chambers.fetchFederalMembers': async function () {
        // Ensure server-side execution
        if (!Meteor.isServer) {
            return false;
        }

        // Ensure the user is authorized
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }

        // Map human-readable province to our stored province codes
        const provinceCodes = {
            "newfoundland and labrador": "nl",
            "prince edward island": "pe",
            "nova scotia": "ns",
            "new brunswick": "nb",
            "quebec": "qc",
            "ontario": "on",
            "manitoba": "mb",
            "saskatchewan": "sk",
            "alberta": "ab",
            "british columbia": "bc",
            "yukon": "yt",
            "northwest territories": "nt",
            "nunavut": "nu",
        };

    function slugifyName(name) {
            if (!name) return '';
            return String(name)
                .toLowerCase()
                .replace(/—/g, '-')              // em-dash to hyphen
        .replace(/[^\w\s-]/g, '')       // strip punctuation except hyphen
                .replace(/\s+/g, '-')            // spaces to hyphen
                .replace(/-+/g, '-');             // collapse hyphens
        }

        try {
            // Pull current constituencies + members from Parliament XML helper
            const xmlChambers = await Meteor.call('admin.chambers.syncFromParliamentXml');
            let matched = 0;
            let updated = 0;
            const notFound = [];

            for (const item of xmlChambers) {
                const provinceReadable = (item.province || '').toLowerCase();
                const provinceCode = provinceCodes[provinceReadable];
                const seoUrl = slugifyName(item.name);

                if (!provinceCode || !seoUrl) {
                    notFound.push({ name: item.name, province: item.province, reason: 'missing-province-or-slug' });
                    continue;
                }

                const existing = await Chambers.findOneAsync({ province: provinceCode, seoUrl });
                if (!existing) {
                    notFound.push({ name: item.name, province: item.province, key: `${provinceCode}/${seoUrl}` });
                    continue;
                }
                matched++;

                const setFields = {
                    lastCheckedAt: new Date().getTime(),
                    // Persist the current member record as-is from XML for now
                    currentMember: item.currentMember ? {
                        ...item.currentMember,
                        source: 'parliament-xml',
                        updatedAt: new Date().getTime(),
                    } : null,
                };

                // Only update if changed or missing
                const needsUpdate = !!item.currentMember && JSON.stringify(existing.currentMember || {}) !== JSON.stringify(item.currentMember || {});
                if (needsUpdate || !existing.currentMember) {
                    await Chambers.updateAsync({ _id: existing._id }, { $set: setFields });
                    updated++;
                } else {
                    // Still bump lastCheckedAt for bookkeeping
                    await Chambers.updateAsync({ _id: existing._id }, { $set: { lastCheckedAt: setFields.lastCheckedAt } });
                }

                // Small delay to keep the event loop cooperative
                await new Promise(r => setTimeout(r, 5));
            }

            return {
                success: true,
                totalXml: xmlChambers.length,
                matched,
                updated,
                notFoundCount: notFound.length,
                notFound,
                message: `Processed ${xmlChambers.length} XML entries; matched ${matched}, updated ${updated}.`
            };

        } catch (error) {
            console.error('Error fetching federal members:', error);
            throw new Meteor.Error('fetch-members-failed', error.message || 'Failed to fetch federal members');
        }
    }
});

// Add scraper to pull contact info from member profile pages on ourcommons.ca
// Shared server task (callable from both Meteor method and REST API)
if (Meteor.isServer) {
    // Expose under a global namespace to avoid import hassles in Meteor load order
    global.AdminChambers = global.AdminChambers || {};
    global.AdminChambers.scrapeMemberContactsTask = async function scrapeMemberContactsTask(options = {}) {
        const { limit = 1000, onlyMissing = false, delayMs = 300 } = options || {};

        const { JSDOM } = require('jsdom');

        function toSlug(str) {
            if (!str) return '';
            return String(str)
                .normalize('NFD')
                .replace(/\p{Diacritic}/gu, '')
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .trim()
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-');
        }

        function uniq(arr) {
            return Array.from(new Set(arr.filter(Boolean)));
        }

        async function fetchHtml(url) {
            let resp;
            try {
                resp = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; CivilCitizensBot/1.0)'
                    }
                });
            } catch (e) {
                throw new Meteor.Error('network-failed', e.message || 'Network error');
            }
            if (!resp.ok) {
                throw new Meteor.Error('http-error', `Status ${resp.status}`);
            }
            return await resp.text();
        }

        function extractContacts(html) {
            const dom = new JSDOM(html);
            const doc = dom.window.document;

            // Prefer the contact section; fall back to scanning whole doc
            const root = doc.querySelector('#contact') || doc.querySelector('section#contact') || doc;

            const anchors = Array.from(root.querySelectorAll('a[href]'));
            const websites = uniq(
                anchors
                    .map(a => a.getAttribute('href'))
                    .filter(href => href && href.startsWith('http'))
                    .filter(href => !/ourcommons\.ca/i.test(href))
            );
            const emails = uniq(
                anchors
                    .map(a => a.getAttribute('href'))
                    .filter(href => href && href.startsWith('mailto:'))
                    .map(href => href.replace(/^mailto:/i, ''))
            );
            const phones = uniq(
                anchors
                    .map(a => a.getAttribute('href'))
                    .filter(href => href && href.startsWith('tel:'))
                    .map(href => href.replace(/^tel:/i, ''))
            );

            return { websites, emails, phones };
        }

        // Build query: iterate chambers with a currentMember having a personId
        const query = onlyMissing
            ? { 'currentMember.personId': { $exists: true }, $or: [ { 'currentMember.websites': { $exists: false } }, { 'currentMember.websites': { $size: 0 } } ] }
            : { 'currentMember.personId': { $exists: true } };

        const list = await Chambers.find(query, { fields: { currentMember: 1, province: 1, seoUrl: 1 } }).fetchAsync();
        let processed = 0;
        let updated = 0;
        const errors = [];
        const examples = [];

        for (const chamber of list) {
            if (processed >= limit) break;
            processed++;

            const cm = chamber.currentMember || {};
            const pid = cm.personId;
            const first = cm.firstName || '';
            const last = cm.lastName || '';
            if (!pid || !first || !last) continue;

            const slug = `${toSlug(first)}-${toSlug(last)}`.replace(/-+/g, '-');
            const url = `https://www.ourcommons.ca/Members/en/${slug}(${pid})#contact`;

            try {
                const html = await fetchHtml(url);
                const info = extractContacts(html);

                const setUpdate = {
                    'currentMember.source': 'parliament-xml+scrape',
                    'currentMember.updatedAt': new Date().getTime(),
                };
                if (info.websites.length) setUpdate['currentMember.websites'] = info.websites;
                if (info.emails.length) setUpdate['currentMember.emails'] = info.emails;
                if (info.phones.length) setUpdate['currentMember.phones'] = info.phones;

                if (Object.keys(setUpdate).length > 2) {
                    await Chambers.updateAsync({ _id: chamber._id }, { $set: setUpdate });
                    updated++;
                }

                if (examples.length < 5) {
                    examples.push({ url, ...info });
                }
            } catch (e) {
                errors.push({ chamberId: chamber._id, url, reason: e.reason || e.message || String(e) });
            }

            await new Promise(r => setTimeout(r, delayMs));
        }

        return { success: true, processed, updated, errorsCount: errors.length, errors, examples };
    };
}

Meteor.methods({
    'admin.chambers.scrapeMemberContacts': async function (options = {}) {
        if (!Meteor.isServer) return false;
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }
        // Optional: enforce admin role when called as a method (keeps parity with REST auth)
        try {
            const meta = await UserMeta.findOneAsync({ ownerUserId: this.userId });
            if (!meta || meta.admin !== true) {
                throw new Meteor.Error('not-authorized', 'Admin privileges required.');
            }
        } catch (e) {
            if (e instanceof Meteor.Error) throw e;
            throw new Meteor.Error('not-authorized', 'Admin privileges required.');
        }

        return await global.AdminChambers.scrapeMemberContactsTask(options);
    }
});