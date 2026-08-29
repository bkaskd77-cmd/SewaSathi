import type { LocalisedDocument } from "@/lib/content/types";

/**
 * DRAFT — not reviewed by a lawyer. See LAUNCH-BLOCKERS.md.
 *
 * Deliberately short. A refund policy is read by somebody who is already
 * unhappy, and length reads as evasion.
 */
export const refunds: LocalisedDocument = {
  en: {
    title: "Refund policy",
    lead: "You pay after the work is done, so most of this is about the few times something still goes wrong.",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "when-you-pay",
        heading: "When you pay",
        blocks: [
          {
            p: "After the work is finished, never before. That is the whole basis of this policy: in almost every case there is nothing to refund, because you have not paid yet.",
          },
          {
            p: "If the professional finds the job is bigger than described, you approve the new price before they carry on. If you do not approve it, you have not agreed to that price and you do not owe it.",
          },
        ],
      },
      {
        id: "cancelling",
        heading: "Cancelling",
        blocks: [
          {
            p: "Free of charge up to one hour before the agreed time, from the booking screen. Nothing has been paid, so nothing is refunded.",
          },
          {
            p: "Within the last hour, or if nobody is at the address when the professional arrives and we were not told, a visit fee applies. It covers their travel and the slot they held.",
          },
          {
            p: "If the professional cancels or does not turn up, you pay nothing — including no visit fee — and we find you someone else.",
          },
        ],
      },
      {
        id: "work-not-right",
        heading: "If the work is not right",
        blocks: [
          {
            p: "Report it from the booking within 48 hours of the job finishing.",
          },
          {
            ul: [
              "First we send someone back to put it right, at no cost to you. Usually the same professional, unless you would rather not.",
              "If the second visit does not resolve it, we refund what you paid for the job in full.",
              "If the problem is urgent and you cannot wait for a revisit, tell us on the phone and we will agree the refund straight away.",
            ],
          },
        ],
      },
      {
        id: "how-refunds-arrive",
        heading: "How a refund reaches you",
        blocks: [
          {
            dl: [
              {
                term: "Paid by eSewa or Khalti",
                detail:
                  "Reversed to the same wallet. We start it within 2 working days; the wallet usually shows it within 5.",
              },
              {
                term: "Paid in cash",
                detail:
                  "We send it to your eSewa or Khalti account, or you can collect it in cash from our office. Your choice, and we will ask rather than assume.",
              },
            ],
          },
        ],
      },
      {
        id: "not-refundable",
        heading: "What we cannot refund",
        blocks: [
          {
            ul: [
              "Parts already bought and fitted at your request, where the part itself is not faulty.",
              "Work you approved a revised price for, carried out as agreed, that you later changed your mind about.",
              "Damage that was already there and that the repair simply revealed.",
              "Work arranged privately with a professional outside SajiloKaam.",
            ],
          },
          {
            p: "If you disagree with any of these in your case, say so. These are rules of thumb, not a wall.",
          },
        ],
      },
      {
        id: "how-to-ask",
        heading: "How to ask",
        blocks: [
          {
            p: "Open the booking and report the problem, or call the number on our contact page. Tell us what was agreed, what happened, and what you would like done. We aim to answer within one working day.",
          },
          {
            p: "Nothing here limits your rights under Nepali consumer law.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "रकम फिर्ता नीति",
    lead: "तपाईं काम सकिएपछि तिर्नुहुन्छ, त्यसैले यो नीति प्रायः थोरै पटक बिग्रिने अवस्थाबारे हो।",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "when-you-pay",
        heading: "कहिले तिर्नुहुन्छ",
        blocks: [
          {
            p: "काम सकिएपछि, पहिले कहिल्यै होइन। यही नै यो नीतिको आधार हो: झन्डै हरेक अवस्थामा फिर्ता गर्नुपर्ने केही हुँदैन, किनभने तपाईंले तिर्नै भएको हुँदैन।",
          },
          {
            p: "भनेभन्दा ठूलो काम रहेछ भने प्राविधिकले अघि बढ्नुअघि तपाईंले नयाँ मूल्य मञ्जुर गर्नुहुन्छ। मञ्जुर गर्नुभएन भने त्यो मूल्यमा सहमति भएकै होइन, र तिर्नु पनि पर्दैन।",
          },
        ],
      },
      {
        id: "cancelling",
        heading: "रद्द गर्दा",
        blocks: [
          {
            p: "तय भएको समयभन्दा एक घण्टा अगाडिसम्म बुकिङ पृष्ठबाट नि:शुल्क। केही तिरिएकै छैन, त्यसैले फिर्ता गर्नुपर्ने पनि केही छैन।",
          },
          {
            p: "अन्तिम एक घण्टाभित्र, वा प्राविधिक आइपुग्दा ठेगानामा कोही नभेटिए र हामीलाई नभनिएको भए, भ्रमण शुल्क लाग्छ। यसले उहाँको यातायात र छुट्याइएको समय धान्छ।",
          },
          {
            p: "प्राविधिकले रद्द गर्नुभयो वा आउनुभएन भने तपाईंले केही तिर्नु पर्दैन — भ्रमण शुल्क पनि होइन — र हामी अर्को व्यक्ति खोजिदिन्छौं।",
          },
        ],
      },
      {
        id: "work-not-right",
        heading: "काम राम्रो भएन भने",
        blocks: [
          { p: "काम सकिएको ४८ घण्टाभित्र बुकिङबाटै जानकारी दिनुहोस्।" },
          {
            ul: [
              "पहिले हामी मिलाउन कसैलाई फेरि पठाउँछौं, तपाईंलाई कुनै खर्च नलगाई। प्रायः उही प्राविधिक, तपाईंलाई मन नपरे अर्को।",
              "दोस्रो पटकमा पनि मिलेन भने काम बापत तिर्नुभएको पूरै रकम फिर्ता गर्छौं।",
              "समस्या जरुरी छ र फेरि आउने पर्खन सक्नुहुन्न भने फोनमा भन्नुहोस्, हामी तत्कालै फिर्ताको सहमति गर्छौं।",
            ],
          },
        ],
      },
      {
        id: "how-refunds-arrive",
        heading: "फिर्ता रकम कसरी आइपुग्छ",
        blocks: [
          {
            dl: [
              {
                term: "इसेवा वा खल्तीबाट तिर्नुभएको भए",
                detail:
                  "त्यही वालेटमै फिर्ता हुन्छ। हामी २ कार्यदिनभित्र सुरु गर्छौं; वालेटमा प्रायः ५ दिनभित्र देखिन्छ।",
              },
              {
                term: "नगदमा तिर्नुभएको भए",
                detail:
                  "तपाईंको इसेवा वा खल्ती खातामा पठाउँछौं, वा हाम्रो कार्यालयबाट नगदै लिन सक्नुहुन्छ। तपाईंकै रोजाइ — हामी अनुमान गर्दैनौँ, सोध्छौं।",
              },
            ],
          },
        ],
      },
      {
        id: "not-refundable",
        heading: "के फिर्ता गर्न सकिँदैन",
        blocks: [
          {
            ul: [
              "तपाईंकै भनाइमा किनेर जडान भइसकेका पार्ट्स, जब पार्ट्स आफैँमा बिग्रिएको छैन।",
              "तपाईंले नयाँ मूल्य मञ्जुर गरेर सहमतिअनुसार भइसकेको काम, जसमा पछि मन फेरिएको हो।",
              "पहिल्यैदेखि रहेको क्षति, जुन मर्मत गर्दा देखिन आएको मात्र हो।",
              "सजिलो कामबाहिर निजी रूपमा मिलाइएको काम।",
            ],
          },
          {
            p: "आफ्नो अवस्थामा यीमध्ये कुनैसँग असहमत हुनुहुन्छ भने भन्नुहोस्। यी सामान्य आधार हुन्, छेकबार होइनन्।",
          },
        ],
      },
      {
        id: "how-to-ask",
        heading: "कसरी माग्ने",
        blocks: [
          {
            p: "बुकिङ खोलेर समस्या जनाउनुहोस्, वा सम्पर्क पृष्ठको नम्बरमा फोन गर्नुहोस्। के तय भएको थियो, के भयो, र तपाईं के चाहनुहुन्छ — भन्नुहोस्। हामी एक कार्यदिनभित्र जवाफ दिने लक्ष्य राख्छौं।",
          },
          {
            p: "यहाँ लेखिएको कुनै कुराले नेपाली उपभोक्ता कानुनअन्तर्गतका तपाईंका अधिकार घटाउँदैन।",
          },
        ],
      },
    ],
  },
};
