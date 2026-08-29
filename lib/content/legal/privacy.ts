import type { LocalisedDocument } from "@/lib/content/types";

/**
 * DRAFT — not reviewed by a lawyer. See LAUNCH-BLOCKERS.md.
 *
 * Written against what the code actually does, not against a template. The
 * specifics that matter and that a generic policy would miss: the phone number
 * is the identity, every triage is logged to `triage_logs`, the photo is sent
 * to Anthropic and is never stored, and the professional gets your address.
 */
export const privacy: LocalisedDocument = {
  en: {
    title: "Privacy policy",
    lead: "What we hold about you, why we hold it, and who else sees it. Specific about the parts most policies leave vague.",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "what-we-collect",
        heading: "What we collect",
        blocks: [
          {
            dl: [
              {
                term: "Your mobile number",
                detail:
                  "This is your identity on SajiloKaam. There is no email and no password. We use it to sign you in, to send the professional's arrival updates, and so the person coming to your door can call you.",
              },
              {
                term: "Your name and preferred language",
                detail:
                  "You give us these once, at sign-up. The name is not optional because a professional standing at a gate needs to know who they are visiting.",
              },
              {
                term: "What you type into the search box",
                detail:
                  "The description of your problem, so we can work out which trade you need and what it should cost.",
              },
              {
                term: "Photos you attach",
                detail:
                  "Sent to our AI provider to be read, then discarded. We do not store them — see section 3.",
              },
              {
                term: "Your bookings and address",
                detail:
                  "Where the work is, when it is, what was agreed, what was paid.",
              },
              {
                term: "Basic technical data",
                detail:
                  "IP address and browser, used to apply rate limits and to keep the service up. We do not run advertising trackers.",
              },
            ],
          },
        ],
      },
      {
        id: "triage-logs",
        heading: "The triage log, in detail",
        blocks: [
          {
            p: "Every time you describe a problem, we write one row to a table called triage_logs. We are naming it because a vague sentence about “usage data” would hide something you should be able to see clearly.",
          },
          {
            p: "That row holds: the text you typed, whether a photo was attached (yes or no — not the photo), the category and urgency we decided, the price band we quoted, how long it took, whether the answer came from the AI or from our own keyword matcher, and whether a safety hazard was detected.",
          },
          {
            p: "It exists for one reason: it is the only record of whether our published prices are right and whether the safety detection is working. We read it in aggregate. It is linked to your account when you are signed in, so that you can ask us to delete it.",
          },
        ],
      },
      {
        id: "photos",
        heading: "Photos are not stored",
        blocks: [
          {
            p: "When you attach a photo, your browser shrinks it and sends it to us. We pass it to our AI provider to be read alongside your description, and we keep the answer. We do not write the image to a database, we do not put it in file storage, and it is not attached to your booking.",
          },
          {
            p: "The only trace left is a yes-or-no flag in the triage log recording that a photo was sent. This is deliberate: a photograph of the inside of someone's home is the most sensitive thing this product touches, and the safest way to hold it is not to.",
          },
        ],
      },
      {
        id: "ai",
        heading: "The AI, and what it sees",
        blocks: [
          {
            p: "Your description and any photo are sent to Anthropic, who run the Claude model we use to decide which trade you need. That processing happens on their servers, outside Nepal.",
          },
          {
            p: "We send only what you typed and the photo. We do not send your name, your number, your address or your booking history.",
          },
          {
            p: "If the AI is unavailable, a keyword matcher running on our own servers answers instead, and nothing leaves our infrastructure. You get an answer either way.",
          },
        ],
      },
      {
        id: "sharing",
        heading: "Who else sees your data",
        blocks: [
          {
            dl: [
              {
                term: "The professional you book",
                detail:
                  "Your name, mobile number and the address of the job. They need all three to arrive and to call you if they cannot find the gate. They do not see your other bookings.",
              },
              {
                term: "Our SMS provider",
                detail:
                  "Your mobile number, to deliver the sign-in code and arrival updates.",
              },
              {
                term: "eSewa and Khalti",
                detail:
                  "Only when you choose to pay that way, and only what the payment needs. We never see or hold your card or wallet credentials.",
              },
              {
                term: "Anthropic",
                detail: "Your problem description and photo, as in section 4.",
              },
              {
                term: "Supabase",
                detail:
                  "Our database and authentication provider, who host the data described above on our behalf.",
              },
            ],
          },
          {
            p: "We do not sell your data. We do not share it for advertising. We will disclose it if a Nepali court or a law enforcement authority lawfully requires it.",
          },
        ],
      },
      {
        id: "retention",
        heading: "How long we keep things",
        blocks: [
          {
            ul: [
              "Your account and booking history: while your account is open, and for seven years after a booking, because tax and accounting rules require it.",
              "Triage logs: 24 months, then deleted.",
              "Sign-in codes: minutes. They expire and are discarded.",
              "Photos: not retained at all.",
            ],
          },
        ],
      },
      {
        id: "your-rights",
        heading: "Your rights",
        blocks: [
          {
            p: "You can ask us to show you everything we hold about you, to correct anything wrong, or to delete your account and its data. Call the number on our contact page, or write to us, and we will do it within 30 days.",
          },
          {
            p: "Some records survive deletion where the law requires us to keep them — a completed booking that appears in our accounts, for example. We will tell you exactly what was kept and why.",
          },
        ],
      },
      {
        id: "cookies",
        heading: "Cookies",
        blocks: [
          {
            p: "Three, and no more: one that keeps you signed in, one that remembers whether you read the site in Nepali or English, and one that remembers your light or dark theme.",
          },
          {
            p: "There are no advertising cookies and no third-party analytics trackers on this site.",
          },
        ],
      },
      {
        id: "security",
        heading: "Security",
        blocks: [
          {
            p: "Data is encrypted in transit and at rest. Access to the database is restricted by row-level security rules, so one customer's records cannot be read by another. Sign-in is by one-time code, which means there is no password of yours for anyone to steal from us.",
          },
          {
            p: "No system is perfect. If we ever suffer a breach that affects you, we will tell you and the relevant authority without delay.",
          },
        ],
      },
      {
        id: "children",
        heading: "Children",
        blocks: [
          {
            p: "SajiloKaam is for people aged 18 and over. We do not knowingly collect data about children. If you believe a child has created an account, tell us and we will remove it.",
          },
        ],
      },
      {
        id: "contact",
        heading: "Contact and changes",
        blocks: [
          {
            p: "Questions about any of this go through our contact page. We will update this policy as the product changes, and the date at the top will change with it.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "गोपनीयता नीति",
    lead: "तपाईंको के-के कुरा हामीसँग छ, किन छ, र अरू कसले देख्छ। धेरै नीतिले अस्पष्ट छाड्ने ठाउँमा यो प्रस्ट छ।",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "what-we-collect",
        heading: "हामी के-के लिन्छौं",
        blocks: [
          {
            dl: [
              {
                term: "तपाईंको मोबाइल नम्बर",
                detail:
                  "सजिलो काममा यही तपाईंको परिचय हो। इमेल छैन, पासवर्ड छैन। साइन इन गराउन, प्राविधिक आउने जानकारी पठाउन, र ढोकामा आउने व्यक्तिले तपाईंलाई फोन गर्न सकून् भनेर प्रयोग हुन्छ।",
              },
              {
                term: "तपाईंको नाम र रुचाइएको भाषा",
                detail:
                  "साइन अप गर्दा एक पटक दिनुहुन्छ। नाम अनिवार्य छ किनभने गेटमा उभिएको प्राविधिकलाई कसकहाँ आएको हो थाहा हुनुपर्छ।",
              },
              {
                term: "खोज बाकसमा लेख्नुभएको कुरा",
                detail:
                  "तपाईंको समस्याको विवरण, ताकि कुन पेसा चाहिन्छ र कति खर्च लाग्छ भनी हामी पत्ता लगाउन सकौँ।",
              },
              {
                term: "तपाईंले थप्नुभएको फोटो",
                detail:
                  "पढ्नका लागि हाम्रो एआई सेवा प्रदायककहाँ पठाइन्छ, त्यसपछि हटाइन्छ। हामी भण्डारण गर्दैनौँ — दफा ३ हेर्नुहोस्।",
              },
              {
                term: "तपाईंका बुकिङ र ठेगाना",
                detail: "काम कहाँ हो, कहिले हो, के तय भयो, कति तिरियो।",
              },
              {
                term: "आधारभूत प्राविधिक विवरण",
                detail:
                  "आईपी ठेगाना र ब्राउजर — दर सीमा लगाउन र सेवा चलिरहन। विज्ञापनको ट्र्याकर हामी चलाउँदैनौँ।",
              },
            ],
          },
        ],
      },
      {
        id: "triage-logs",
        heading: "ट्राइएज लग, विस्तारमा",
        blocks: [
          {
            p: "तपाईंले समस्या लेख्नुभएको हरेक पटक triage_logs भन्ने तालिकामा एउटा पङ्क्ति लेखिन्छ। नाम नै किन भन्यौँ भने “प्रयोगको विवरण” जस्तो अस्पष्ट वाक्यले तपाईंले प्रस्ट देख्न पाउनुपर्ने कुरा लुकाउँछ।",
          },
          {
            p: "त्यो पङ्क्तिमा हुन्छ: तपाईंले लेख्नुभएको पाठ, फोटो थपिएको थियो कि थिएन (हो वा होइन मात्र — फोटो होइन), हामीले तय गरेको सेवा र हतार, भनिएको मूल्य दायरा, कति समय लाग्यो, जवाफ एआईबाट आयो कि हाम्रै किवर्ड मिलानबाट, र कुनै सुरक्षा जोखिम पत्ता लाग्यो कि लागेन।",
          },
          {
            p: "यो एउटै कारणले छ: हाम्रा प्रकाशित मूल्य ठीक छन् कि छैनन् र सुरक्षा पहिचान काम गरिरहेको छ कि छैन भन्ने एक मात्र अभिलेख यही हो। हामी यसलाई समग्र रूपमा हेर्छौं। साइन इन हुनुहुँदा यो तपाईंको खातासँग जोडिन्छ, ताकि तपाईंले मेट्न भन्न सक्नुहोस्।",
          },
        ],
      },
      {
        id: "photos",
        heading: "फोटो भण्डारण हुँदैन",
        blocks: [
          {
            p: "तपाईंले फोटो थप्नुहुँदा ब्राउजरले त्यसलाई सानो बनाएर हामीकहाँ पठाउँछ। हामी त्यसलाई तपाईंको विवरणसँगै पढ्न एआई सेवा प्रदायककहाँ पठाउँछौं र जवाफ मात्र राख्छौं। तस्बिर डेटाबेसमा लेखिँदैन, फाइल भण्डारणमा राखिँदैन, र बुकिङसँग जोडिँदैन।",
          },
          {
            p: "बाँकी रहने भनेको ट्राइएज लगमा फोटो पठाइएको थियो भन्ने हो-होइनको सङ्केत मात्र हो। यो जानाजान गरिएको हो: कसैको घरभित्रको तस्बिर यो उत्पादनले छुने सबैभन्दा संवेदनशील कुरा हो, र त्यसलाई सुरक्षित राख्ने सबैभन्दा पक्का तरिका नराख्नु नै हो।",
          },
        ],
      },
      {
        id: "ai",
        heading: "एआई, र यसले देख्ने कुरा",
        blocks: [
          {
            p: "तपाईंको विवरण र फोटो एन्थ्रोपिककहाँ पठाइन्छ, जसले हामीले प्रयोग गर्ने क्लाउड मोडेल चलाउँछ र कुन पेसा चाहिन्छ भनी तय गर्छ। त्यो प्रशोधन उनीहरूकै सर्भरमा, नेपालबाहिर हुन्छ।",
          },
          {
            p: "हामी तपाईंले लेख्नुभएको कुरा र फोटो मात्र पठाउँछौं। नाम, नम्बर, ठेगाना वा बुकिङको इतिहास पठाउँदैनौँ।",
          },
          {
            p: "एआई उपलब्ध नभए हाम्रै सर्भरमा चल्ने किवर्ड मिलानले जवाफ दिन्छ, र केही पनि हाम्रो पूर्वाधारबाहिर जाँदैन। जे भए पनि तपाईंले जवाफ पाउनुहुन्छ।",
          },
        ],
      },
      {
        id: "sharing",
        heading: "अरू कसले तपाईंको विवरण देख्छ",
        blocks: [
          {
            dl: [
              {
                term: "तपाईंले बुक गर्नुभएको प्राविधिक",
                detail:
                  "तपाईंको नाम, मोबाइल नम्बर र कामको ठेगाना। आइपुग्न र गेट नभेटिए फोन गर्न तीनै वटा चाहिन्छ। तपाईंका अरू बुकिङ उहाँले देख्नुहुन्न।",
              },
              {
                term: "हाम्रो एसएमएस सेवा प्रदायक",
                detail:
                  "साइन इन कोड र आउने जानकारी पठाउन तपाईंको मोबाइल नम्बर।",
              },
              {
                term: "इसेवा र खल्ती",
                detail:
                  "तपाईंले त्यसै तरिकाले तिर्न रोज्दा मात्र, र भुक्तानीलाई चाहिने कुरा मात्र। तपाईंको कार्ड वा वालेटको विवरण हामी न देख्छौं न राख्छौं।",
              },
              {
                term: "एन्थ्रोपिक",
                detail: "दफा ४ मा भनिएअनुसार तपाईंको समस्याको विवरण र फोटो।",
              },
              {
                term: "सुपाबेस",
                detail:
                  "हाम्रो डेटाबेस र प्रमाणीकरण सेवा प्रदायक, जसले हाम्रो तर्फबाट माथि उल्लेख गरिएको विवरण होस्ट गर्छ।",
              },
            ],
          },
          {
            p: "हामी तपाईंको विवरण बेच्दैनौँ। विज्ञापनका लागि साझा गर्दैनौँ। नेपालको अदालत वा कानुन कार्यान्वयन निकायले कानुनसम्मत रूपमा माग गरे भने उपलब्ध गराउँछौं।",
          },
        ],
      },
      {
        id: "retention",
        heading: "कति समय राख्छौं",
        blocks: [
          {
            ul: [
              "खाता र बुकिङको इतिहास: खाता खुला रहेसम्म, र बुकिङपछि सात वर्ष — कर र लेखाका नियमले माग गरेकाले।",
              "ट्राइएज लग: २४ महिना, त्यसपछि मेटिन्छ।",
              "साइन इन कोड: केही मिनेट। म्याद सकिएपछि हटाइन्छ।",
              "फोटो: राखिँदै राखिँदैन।",
            ],
          },
        ],
      },
      {
        id: "your-rights",
        heading: "तपाईंका अधिकार",
        blocks: [
          {
            p: "हामीसँग भएको तपाईंको सबै विवरण देखाउन, गलत भएको सच्याउन, वा खाता र त्यसको विवरण मेट्न भन्न सक्नुहुन्छ। सम्पर्क पृष्ठको नम्बरमा फोन गर्नुहोस् वा लेख्नुहोस्, हामी ३० दिनभित्र गर्नेछौं।",
          },
          {
            p: "कानुनले राख्नै पर्ने भनेका केही अभिलेख मेटेपछि पनि रहन्छन् — जस्तै हाम्रो लेखामा देखिने सकिएको बुकिङ। के राखियो र किन राखियो, हामी ठ्याक्कै बताउँछौं।",
          },
        ],
      },
      {
        id: "cookies",
        heading: "कुकी",
        blocks: [
          {
            p: "तीन वटा, त्योभन्दा बढी होइन: एउटाले तपाईंलाई साइन इन राख्छ, एउटाले साइट नेपालीमा पढ्नुहुन्छ कि अङ्ग्रेजीमा भन्ने सम्झन्छ, र एउटाले उज्यालो कि अँध्यारो थिम सम्झन्छ।",
          },
          {
            p: "यो साइटमा विज्ञापनका कुकी छैनन्, र तेस्रो पक्षका एनालिटिक्स ट्र्याकर पनि छैनन्।",
          },
        ],
      },
      {
        id: "security",
        heading: "सुरक्षा",
        blocks: [
          {
            p: "विवरण पठाउँदा र भण्डारण गर्दा दुवैमा इन्क्रिप्ट गरिन्छ। डेटाबेसमा पहुँच पङ्क्ति-स्तरको सुरक्षा नियमले सीमित छ, त्यसैले एक ग्राहकको अभिलेख अर्कोले पढ्न सक्दैन। साइन इन एक पटकको कोडबाट हुन्छ, अर्थात् हामीबाट कसैले चोर्न सक्ने तपाईंको पासवर्ड नै छैन।",
          },
          {
            p: "कुनै पनि प्रणाली पूर्ण हुँदैन। तपाईंलाई असर पर्ने गरी कहिल्यै विवरण चुहियो भने तपाईंलाई र सम्बन्धित निकायलाई ढिला नगरी जानकारी दिनेछौं।",
          },
        ],
      },
      {
        id: "children",
        heading: "बालबालिका",
        blocks: [
          {
            p: "सजिलो काम १८ वर्ष पूरा भएकाहरूका लागि हो। बालबालिकाको विवरण हामी जानीजानी लिँदैनौँ। कुनै बालबालिकाले खाता खोलेको लाग्छ भने भन्नुहोस्, हामी हटाइदिन्छौं।",
          },
        ],
      },
      {
        id: "contact",
        heading: "सम्पर्क र परिवर्तन",
        blocks: [
          {
            p: "यीमध्ये कुनै कुराबारे प्रश्न भए सम्पर्क पृष्ठबाट सोध्नुहोस्। उत्पादन बदलिँदै जाँदा यो नीति अद्यावधिक हुन्छ, र माथिको मिति पनि सँगै फेरिन्छ।",
          },
        ],
      },
    ],
  },
};
