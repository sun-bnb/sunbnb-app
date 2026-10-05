/**
 * Privacy notice for try.sunbnb.app (track 027 P3). DRAFT legal text — founder review required
 * before production (.claude/rules/deploys.md, user-facing copy gate).
 *
 * Every claim must stay true to the code: what `Lead` stores, the retention in
 * `@repo/data/lead-model`, and the third parties the pages actually call. Bump CONSENT_VERSION
 * (lib/demo-request.ts) whenever the substance changes — leads record which version they agreed to.
 */
import { RETENTION_ANONYMOUS_DAYS, RETENTION_CONTACT_MONTHS } from '@repo/data/lead-model'
import type { Locale } from './places.ts'

export interface PrivacySection {
  heading: string
  paragraphs: string[]
}

export interface Controller {
  companyName: string
  companyAddress: string
  businessId: string
  contactEmail: string
}

export function privacySections(locale: Locale, c: Controller): PrivacySection[] {
  const who = [c.companyName, c.companyAddress, c.businessId].filter(Boolean).join(', ')
  const d = RETENTION_ANONYMOUS_DAYS
  const m = RETENTION_CONTACT_MONTHS

  if (locale === 'es') {
    return [
      { heading: 'Quién es responsable', paragraphs: [`El responsable del tratamiento es ${who}. Contacto: ${c.contactEmail}.`] },
      {
        heading: 'Qué datos recogemos',
        paragraphs: [
          'Cuando creas una maqueta guardamos la playa que elegiste (nombre, dirección y coordenadas de Google), el número de hamacas, cómo ajustaste la distribución, tu idioma y, si llegaste desde un anuncio, los parámetros de campaña del enlace (utm). Esto no incluye datos personales.',
          'Si solicitas una demo, guardamos además tu nombre, email y/o teléfono, el nombre de tu negocio, tu mensaje y el momento en que diste tu consentimiento.',
          'Si usas el asistente de chat con IA, guardamos la conversación junto con tu maqueta.',
        ],
      },
      {
        heading: 'Asistente de chat con IA',
        paragraphs: [
          'El chat de la página de tu maqueta es un asistente de IA, no una persona. Tus mensajes se envían a Anthropic, que proporciona el modelo de IA, para generar las respuestas. Si escribes un email o un teléfono en el chat, lo tratamos como una solicitud de contacto para una demo y avisamos al equipo.',
        ],
      },
      {
        heading: 'Para qué y con qué base',
        paragraphs: [
          'La maqueta y los datos de campaña sirven para mostrarte tu playa en un enlace que puedes compartir y para saber qué anuncios funcionan (interés legítimo).',
          'Tus datos de contacto se usan solo para contactarte sobre una demo de Sunbnb (consentimiento). Puedes retirar tu consentimiento en cualquier momento escribiendo a ' + c.contactEmail + '.',
        ],
      },
      {
        heading: 'Cuánto tiempo los conservamos',
        paragraphs: [`Las maquetas sin datos de contacto se eliminan ${d} días después de la última actividad. Los contactos de demo se eliminan ${m} meses después de la última actividad.`],
      },
      {
        heading: 'Servicios de terceros',
        paragraphs: [
          'Google Maps Platform recibe lo que escribes en el buscador de playas y muestra el mapa satélite. El servicio público Overpass (datos de OpenStreetMap) recibe únicamente las coordenadas de la playa para encontrar la línea de costa. Anthropic recibe lo que escribes en el chat con IA. Alojamos el sitio en Vercel y los datos en una base de datos de Neon, ambos en la UE. Los avisos de nuevas solicitudes se envían a nuestro equipo mediante Resend.',
        ],
      },
      {
        heading: 'Cookies, publicidad y medición',
        paragraphs: [
          'Usamos una cookie necesaria para recordar tu elección sobre cookies. Solo si aceptas las cookies de marketing cargamos el Píxel de Meta (Meta Platforms Ireland) y las etiquetas de Google Ads (Google Ireland), que instalan sus propias cookies e informan a Meta o Google cuando creas una maqueta, solicitas una demo o te registras, para que podamos medir nuestros anuncios. Puedes cambiar tu elección en cualquier momento con "Configurar cookies" al pie de cada página.',
          'Independientemente de esa elección, registramos recuentos anónimos de cómo avanzan los visitantes por el sitio (por ejemplo, cuántos llegan al formulario de demo), sin cookies y sin identificarte. Una vez creada tu maqueta, estos pasos se registran con ella, junto con los identificadores de anuncio del enlace por el que llegaste (gclid / fbclid), el mensaje del anuncio que viste y qué versión de la página se te mostró: probamos dos versiones del último paso.',
        ],
      },
      {
        heading: 'Tus derechos',
        paragraphs: [`Puedes solicitar acceso, rectificación o supresión de tus datos, u oponerte a su tratamiento, escribiendo a ${c.contactEmail}. También puedes reclamar ante tu autoridad de protección de datos.`],
      },
    ]
  }

  if (locale === 'fi') {
    return [
      { heading: 'Rekisterinpitäjä', paragraphs: [`Rekisterinpitäjä on ${who}. Yhteystiedot: ${c.contactEmail}.`] },
      {
        heading: 'Mitä tietoja keräämme',
        paragraphs: [
          'Kun luot mallin, tallennamme valitsemasi rannan (Googlen nimi, osoite ja koordinaatit), aurinkotuolien määrän, asetteluun tekemäsi muutokset, kielesi ja – jos tulit mainoksesta – linkin kampanjaparametrit (utm). Nämä eivät ole henkilötietoja.',
          'Jos pyydät demoa, tallennamme lisäksi nimesi, sähköpostisi ja/tai puhelinnumerosi, yrityksesi nimen, viestisi ja ajankohdan, jolloin annoit suostumuksesi.',
          'Jos käytät tekoälyavustajaa, tallennamme keskustelun mallisi yhteyteen.',
        ],
      },
      {
        heading: 'Tekoälyavustaja',
        paragraphs: [
          'Mallisivusi chat on tekoälyavustaja, ei ihminen. Viestisi lähetetään tekoälymallin tarjoavalle Anthropicille vastausten tuottamiseksi. Jos kirjoitat chattiin sähköpostiosoitteen tai puhelinnumeron, käsittelemme sen pyyntönä ottaa sinuun yhteyttä demosta, ja tiimille ilmoitetaan.',
        ],
      },
      {
        heading: 'Käyttötarkoitus ja peruste',
        paragraphs: [
          'Mallin ja kampanjatietojen avulla näytämme rantasi jaettavassa linkissä ja seuraamme, mitkä mainokset toimivat (oikeutettu etu).',
          'Yhteystietojasi käytetään vain yhteydenottoon Sunbnb-demosta (suostumus). Voit perua suostumuksesi milloin tahansa kirjoittamalla osoitteeseen ' + c.contactEmail + '.',
        ],
      },
      {
        heading: 'Säilytysaika',
        paragraphs: [`Mallit ilman yhteystietoja poistetaan ${d} päivän kuluttua viimeisestä toiminnasta. Demopyyntöjen yhteystiedot poistetaan ${m} kuukauden kuluttua viimeisestä toiminnasta.`],
      },
      {
        heading: 'Kolmannen osapuolen palvelut',
        paragraphs: [
          'Google Maps Platform vastaanottaa rantahakuun kirjoittamasi tekstin ja näyttää satelliittikartan. Julkinen Overpass-palvelu (OpenStreetMap-tiedot) saa vain rannan koordinaatit rantaviivan löytämiseksi. Anthropic saa sen, mitä kirjoitat tekoälyavustajalle. Sivusto on Vercelin ja tiedot Neonin tietokannassa, molemmat EU:ssa. Ilmoitukset uusista pyynnöistä lähetetään tiimillemme Resendin kautta.',
        ],
      },
      {
        heading: 'Evästeet, mainonta ja mittaus',
        paragraphs: [
          'Käytämme välttämätöntä evästettä evästevalintasi muistamiseen. Vain jos hyväksyt markkinointievästeet, lataamme Meta-pikselin (Meta Platforms Ireland) ja Google Ads -tagit (Google Ireland), jotka asettavat omat evästeensä ja kertovat Metalle tai Googlelle, kun luot mallin, pyydät demoa tai rekisteröidyt, jotta voimme mitata mainontaamme. Voit muuttaa valintaasi milloin tahansa jokaisen sivun alareunan "Evästeasetukset"-linkistä.',
          'Valinnastasi riippumatta tallennamme nimettömiä lukumääriä siitä, miten kävijät etenevät sivustolla (esimerkiksi kuinka moni päätyy demolomakkeelle), ilman evästeitä ja sinua tunnistamatta. Kun olet luonut mallin, nämä vaiheet tallennetaan mallisi yhteyteen yhdessä sen linkin mainostunnisteiden (gclid / fbclid), näkemäsi mainosviestin ja sinulle näytetyn sivuversion kanssa – testaamme kahta versiota viimeisestä vaiheesta.',
        ],
      },
      {
        heading: 'Oikeutesi',
        paragraphs: [`Voit pyytää pääsyä tietoihisi, niiden oikaisua tai poistamista tai vastustaa käsittelyä kirjoittamalla osoitteeseen ${c.contactEmail}. Voit myös tehdä valituksen tietosuojaviranomaiselle.`],
      },
    ]
  }

  return [
    { heading: 'Who is responsible', paragraphs: [`The controller is ${who}. Contact: ${c.contactEmail}.`] },
    {
      heading: 'What we collect',
      paragraphs: [
        'When you create a mockup we store the beach you picked (its Google name, address and coordinates), your number of sunbeds, how you adjusted the layout, your language and — if you came from an ad — the campaign parameters in the link (utm). None of this is personal data.',
        'If you request a demo we also store your name, email and/or phone, your business name, your message and when you gave your consent.',
        'If you use the AI chat assistant we store the conversation with your mockup.',
      ],
    },
    {
      heading: 'AI chat assistant',
      paragraphs: [
        'The chat on your mockup page is an AI assistant, not a person. Your messages are sent to Anthropic, which provides the AI model, to generate the replies. If you type an email address or phone number into the chat, we treat it as a request to be contacted about a demo, and the team is notified.',
      ],
    },
    {
      heading: 'Why, and on what basis',
      paragraphs: [
        'The mockup and campaign data let us show you your beach at a link you can share, and tell us which ads work (legitimate interest).',
        `Your contact details are used only to contact you about a Sunbnb demo (consent). You can withdraw consent at any time by writing to ${c.contactEmail}.`,
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [`Mockups without contact details are deleted ${d} days after their last activity. Demo contacts are deleted ${m} months after their last activity.`],
    },
    {
      heading: 'Third-party services',
      paragraphs: [
        'Google Maps Platform receives what you type into the beach search and serves the satellite map. The public Overpass service (OpenStreetMap data) receives only the beach coordinates, to find the shoreline. Anthropic receives what you write in the AI chat. The site is hosted on Vercel and the data kept in a Neon database, both in the EU. Notifications of new requests reach our team through Resend.',
      ],
    },
    {
      heading: 'Cookies, advertising and measurement',
      paragraphs: [
        'We use a necessary cookie to remember your cookie choice. Only if you accept marketing cookies do we load the Meta Pixel (Meta Platforms Ireland) and Google Ads tags (Google Ireland), which set their own cookies and tell Meta or Google when you create a mockup, request a demo or sign up, so we can measure our ads. You can change your choice any time with "Cookie settings" at the bottom of every page.',
        'Regardless of that choice, we record anonymous counts of how visitors move through the site (for example, how many reach the demo form), without cookies and without identifying you. Once you create a mockup, these steps are recorded with your mockup, together with the ad identifiers in the link you arrived from (gclid / fbclid), the ad message you saw and which version of the page you were shown — we test two versions of the final step.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [`You can ask to access, correct or delete your data, or object to its processing, by writing to ${c.contactEmail}. You can also complain to your data protection authority.`],
    },
  ]
}
