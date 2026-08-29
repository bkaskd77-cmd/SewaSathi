import type { LocalisedDocument } from "@/lib/content/types";

export const about: LocalisedDocument = {
  en: {
    title: "About SajiloKaam",
    lead: "A booking platform for home services in the Kathmandu Valley, built around one idea: you should know the price and the person before anyone sets off.",
    updated: "2026-08-29",
    sections: [
      {
        id: "why",
        heading: "Why this exists",
        blocks: [
          {
            p: "Finding someone to fix a tap in Kathmandu usually means ringing three numbers you got from a neighbour, waiting to find out who is free, and discovering the price when the work is already done. It is slow, and the part that makes people anxious is not the wait — it is not knowing what it will cost.",
          },
          {
            p: "So we built the opposite. Describe what is wrong in your own words, in Nepali or English, and you see the trade you need, the price band, and who is available before you commit to anything.",
          },
        ],
      },
      {
        id: "how-we-are-different",
        heading: "What we do differently",
        blocks: [
          {
            ul: [
              "Published price bands, not quotes on request. The numbers on our service pages are what our professionals actually charge.",
              "The verification breakdown is itemised. You see which checks are complete and which are not, rather than one vague badge.",
              "You pay after the work is done. Cash, eSewa or Khalti — never in advance.",
              "The whole product works in Nepali, not as a translation layer bolted on afterwards.",
            ],
          },
        ],
      },
      {
        id: "where",
        heading: "Where we work",
        blocks: [
          {
            p: "Kathmandu, Lalitpur and Bhaktapur, at ward level, because a ward is how people here actually give directions. We would rather cover three cities properly than claim the whole country.",
          },
        ],
      },
      {
        id: "honest",
        heading: "Where we are today",
        blocks: [
          {
            p: "SajiloKaam is early. We are still onboarding professionals and the booking flow is being built. If something on this site looks like a placeholder, it probably is — we would rather ship in the open than wait behind a coming-soon page.",
          },
        ],
      },
    ],
  },
  ne: {
    title: "सजिलो कामको बारेमा",
    lead: "काठमाडौँ उपत्यकाको घरायसी सेवाका लागि बुकिङ प्लेटफर्म, एउटै सोचमा बनेको: कोही हिँड्नुअघि नै मूल्य र मान्छे दुवै थाहा हुनुपर्छ।",
    updated: "2026-08-29",
    sections: [
      {
        id: "why",
        heading: "यो किन बन्यो",
        blocks: [
          {
            p: "काठमाडौँमा धारा बनाउने मान्छे खोज्नु भनेको प्रायः छिमेकीबाट पाएका तीन वटा नम्बरमा फोन गर्नु, को खाली छ भनेर पर्खनु, र काम सकिएपछि मात्र मूल्य थाहा पाउनु हो। ढिलो त छँदै छ, तर मानिसलाई पिर पर्ने कुरा पर्खाइ होइन — कति लाग्ला भन्ने थाहा नहुनु हो।",
          },
          {
            p: "त्यसैले हामीले ठीक उल्टो बनायौँ। के बिग्रियो आफ्नै शब्दमा भन्नुहोस्, नेपाली वा अङ्ग्रेजीमा — कुन पेसा चाहिन्छ, मूल्य दायरा कति हो, र को उपलब्ध हुनुहुन्छ, केही पक्का गर्नुअघि नै देख्नुहुन्छ।",
          },
        ],
      },
      {
        id: "how-we-are-different",
        heading: "हामी के फरक गर्छौं",
        blocks: [
          {
            ul: [
              "मूल्य दायरा पहिल्यै प्रकाशित, मागेपछि भनिने होइन। सेवा पृष्ठका अङ्क हाम्रा प्राविधिकले साँच्चै लिने रकम हुन्।",
              "प्रमाणीकरणको विवरण छुट्टाछुट्टै देखिन्छ। कुन जाँच पूरा भयो, कुन भएन — एउटै अस्पष्ट चिह्न होइन।",
              "काम सकिएपछि तिर्नुहुन्छ। नगद, इसेवा वा खल्ती — अग्रिम कहिल्यै होइन।",
              "सिङ्गो उत्पादन नेपालीमा चल्छ, पछि थपिएको अनुवादको तह होइन।",
            ],
          },
        ],
      },
      {
        id: "where",
        heading: "हामी कहाँ काम गर्छौं",
        blocks: [
          {
            p: "काठमाडौँ, ललितपुर र भक्तपुर, वडा तहसम्म — किनभने यहाँ मानिसले बाटो भन्ने तरिका नै वडा हो। सारा देश समेट्ने दाबी गर्नुभन्दा तीन सहर राम्ररी समेट्नु ठीक ठान्यौँ।",
          },
        ],
      },
      {
        id: "honest",
        heading: "अहिलेको अवस्था",
        blocks: [
          {
            p: "सजिलो काम अझै सुरुवाती चरणमा छ। प्राविधिक थप्ने काम जारी छ र बुकिङको प्रक्रिया बन्दै छ। यो साइटमा केही कुरा प्लेसहोल्डर जस्तो देखियो भने सम्भवतः त्यो प्लेसहोल्डरै हो — “चाँडै आउँदै” लेखेर लुक्नुभन्दा खुला रूपमा बनाउँदै जानु हामीलाई ठीक लाग्छ।",
          },
        ],
      },
    ],
  },
};
