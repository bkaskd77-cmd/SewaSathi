import type { LocalisedDocument } from "@/lib/content/types";

export const complaint: LocalisedDocument = {
  en: {
    title: "Report a problem",
    lead: "Something went wrong with a job. Here is exactly what happens next, and how long each step takes.",
    updated: "2026-08-29",
    sections: [
      {
        id: "how",
        heading: "How to report it",
        blocks: [
          {
            p: "Open the booking and use the report link, or call +977 9800 000 000. Tell us what was agreed, what actually happened, and what you would like done about it. Photographs help.",
          },
          {
            p: "Do it within 48 hours of the job finishing. That window is what lets us send someone back before the evidence disappears.",
          },
        ],
      },
      {
        id: "what-happens",
        heading: "What happens next",
        blocks: [
          {
            ul: [
              "Within one working day: we call you, and we contact the professional to hear their account.",
              "We send someone back to put the work right, at no cost to you. Usually the same professional, unless you would rather not.",
              "If the second visit does not resolve it, we refund what you paid for the job in full.",
              "If there was damage to your home, tell us within the same 48 hours and we handle the claim with you rather than leaving you to argue it out.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "If it is a safety issue",
        blocks: [
          {
            p: "Call us rather than writing. If there is gas, fire, sparking or exposed wiring, call the emergency services first — 101 fire, 102 ambulance, 100 police — and do not use the fitting again until it has been checked.",
          },
        ],
      },
      {
        id: "conduct",
        heading: "If it is about conduct, not workmanship",
        blocks: [
          {
            p: "Rudeness, pressure to pay outside the app, discrimination, anything that made you feel unsafe: report it the same way and say so explicitly. These are handled by a person, not by the refund process, and they affect whether that professional keeps working with us.",
          },
        ],
      },
      {
        id: "unhappy",
        heading: "If you are still not satisfied",
        blocks: [
          {
            p: "Ask for it to be escalated and we will have someone who was not involved review it. Nothing here limits your rights under Nepali consumer law, or your right to take the matter further.",
          },
        ],
      },
    ],
  },
  ne: {
    title: "समस्या जनाउनुहोस्",
    lead: "काममा केही बिग्रियो। अब के-के हुन्छ र कुन पाइलामा कति समय लाग्छ, ठ्याक्कै यहाँ छ।",
    updated: "2026-08-29",
    sections: [
      {
        id: "how",
        heading: "कसरी जनाउने",
        blocks: [
          {
            p: "बुकिङ खोलेर उजुरीको लिङ्क प्रयोग गर्नुहोस्, वा +977 9800 000 000 मा फोन गर्नुहोस्। के तय भएको थियो, वास्तवमा के भयो, र तपाईं के चाहनुहुन्छ — भन्नुहोस्। फोटो भए सजिलो हुन्छ।",
          },
          {
            p: "काम सकिएको ४८ घण्टाभित्र गर्नुहोस्। त्यही समयसीमाले प्रमाण हराउनुअघि कसैलाई फेरि पठाउन दिन्छ।",
          },
        ],
      },
      {
        id: "what-happens",
        heading: "त्यसपछि के हुन्छ",
        blocks: [
          {
            ul: [
              "एक कार्यदिनभित्र: हामी तपाईंलाई फोन गर्छौं, र प्राविधिकको भनाइ पनि सुन्छौं।",
              "काम मिलाउन कसैलाई फेरि पठाउँछौं, तपाईंलाई कुनै खर्च नलगाई। प्रायः उही प्राविधिक, तपाईंलाई मन नपरे अर्को।",
              "दोस्रो पटकमा पनि मिलेन भने काम बापत तिर्नुभएको पूरै रकम फिर्ता गर्छौं।",
              "घरमा क्षति भएको छ भने त्यही ४८ घण्टाभित्र भन्नुहोस् — तपाईंलाई विवाद गर्न छोड्ने होइन, दाबी हामी तपाईंसँगै मिलाउँछौं।",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "सुरक्षासँग जोडिएको कुरा भए",
        blocks: [
          {
            p: "लेख्नुभन्दा फोन गर्नुहोस्। ग्यास, आगो, स्पार्क वा नाङ्गो तार छ भने पहिले आपत्कालीन सेवालाई फोन गर्नुहोस् — 101 आगलागी, 102 एम्बुलेन्स, 100 प्रहरी — र जाँच नभएसम्म त्यो सामान फेरि नचलाउनुहोस्।",
          },
        ],
      },
      {
        id: "conduct",
        heading: "कामको गुणस्तर होइन, व्यवहारको कुरा भए",
        blocks: [
          {
            p: "रुखो व्यवहार, एपबाहिर तिर्न दबाब, भेदभाव, वा असुरक्षित महसुस गराउने जुनसुकै कुरा: त्यसै तरिकाले जनाउनुहोस् र प्रस्टै भन्नुहोस्। यी रकम फिर्ताको प्रक्रियाबाट होइन, मान्छेबाटै हेरिन्छन्, र त्यो प्राविधिकले हामीसँग काम गरिरहने कि नगर्ने भन्नेमा असर पर्छ।",
          },
        ],
      },
      {
        id: "unhappy",
        heading: "त्यसपछि पनि चित्त बुझेन भने",
        blocks: [
          {
            p: "माथिल्लो तहमा लैजान भन्नुहोस्, हामी यसमा संलग्न नभएको कसैलाई पुनरावलोकन गर्न लगाउँछौं। यहाँ लेखिएको कुनै कुराले नेपाली उपभोक्ता कानुनअन्तर्गतका तपाईंका अधिकार, वा कुरा अझ अघि बढाउने अधिकार घटाउँदैन।",
          },
        ],
      },
    ],
  },
};
