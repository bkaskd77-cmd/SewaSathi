import type { LocalisedDocument } from "@/lib/content/types";

/**
 * The enforcement ladder, written for the people it applies to.
 *
 * DETERRENCE ONLY WORKS IF IT IS VISIBLE. A scoring system nobody can read is
 * not a deterrent — it is a trap, and the first a professional hears of it is
 * the day their work dries up for reasons nobody will explain. That produces
 * exactly the wrong result: the honest ones leave because the platform feels
 * arbitrary, and the dishonest ones simply learn the thresholds by
 * experiment.
 *
 * So every step is named, every step says what triggered it, and every step
 * has a person and an appeal. The page is linked from /providers/join, before
 * anybody signs up, because agreeing to rules you were shown is a different
 * thing from discovering them afterwards.
 *
 * WHAT IS DELIBERATELY NOT HERE: exact thresholds. "Three jobs in thirty days"
 * would be a specification for staying just under it. The signals are named in
 * full and the consequences are named in full; the numbers are ours.
 */

export const standards: LocalisedDocument = {
  en: {
    title: "Our standards, and what happens if they are broken",
    lead:
      "How SajiloKaam handles under-reported jobs and money taken off the platform — what we count, what we never count, and exactly what each step costs.",
    updated: "2026-09-26",
    sections: [
      {
        id: "why",
        heading: "Why this page exists",
        blocks: [
          {
            p: "A professional who does good work and records it honestly should never be worse off than one who does not. That is the whole of it. Every rule below exists to make the honest choice the profitable one, and none of it is worth anything if you cannot read it before you sign up.",
          },
          {
            p: "We would rather explain the rules than catch people. Nothing on this page is a secret, and nothing on it happens without a person looking first, from the third step onward.",
          },
        ],
      },
      {
        id: "the-fee-minimum",
        heading: "Why the fee has a minimum",
        blocks: [
          {
            p: "Our commission is 15%, and it is charged on the job's final amount or on the published minimum for that service, whichever is higher. If a plumbing job's published band starts at Rs 900 and you record Rs 400, the fee is still calculated on Rs 900.",
          },
          {
            p: "This is not a penalty and it does not assume anything about you. It exists so that recording a smaller number than you were paid gains nobody anything — which means nobody has any reason to ask you to.",
          },
          {
            p: "Jobs genuinely do come in under the band: the tap only needed a washer. Say so on the job and a person reviews it, usually the same day. If the whole category keeps landing under its minimum, that is our price being wrong, not yours — we move the band and nobody is penalised for it.",
          },
        ],
      },
      {
        id: "the-guarantee",
        heading: "The guarantee, and what it costs you",
        blocks: [
          {
            p: "We tell every customer that if the same fault comes back within the window for that service, we send somebody back and they pay nothing. That promise is ours to make and yours to honour: you go back and put it right, and that return visit is unpaid.",
          },
          {
            p: "If you genuinely cannot go — you have left the trade, or the customer asks for somebody else — we send another professional and pay them in full for their work. What they were paid then comes off your next earnings, at most a quarter of any one payout, so no week of yours goes to nothing. It shows on your dashboard as a balance you can watch going down. We will not ring you asking for cash, and we will not take money you have already been paid.",
          },
          {
            p: "The other way a balance appears is a refund. If a re-do cannot put it right and a person here decides to pay the customer back, we return our commission on that job in full — we do not keep a fee out of work that failed — and your share of it becomes the balance. On a job refunded in full that is your whole earning from it, so it is the larger of the two cases and worth knowing before it happens.",
          },
          {
            p: "However the balance arose, it comes off future earnings the same way: never more than a quarter of any single payout, and it stops the moment it reaches zero. Three quarters of every payout reaches you untouched however much is owed, which is the point of the cap — a bad month cannot take a week's earnings, and you are never asked for money you have already been paid.",
          },
          {
            p: "If you stop working, it ends. Twelve months with no completed job and the balance is written off — not suspended, not sold on, not waiting for you: gone, and nobody will contact you about it. The listing closes at that point, so coming back means applying again rather than finding an old debt waiting. That is not a mark against you and it is not the same as being removed; a closed listing says only that you stopped, and you are welcome to apply.",
          },
          {
            p: "The window runs from the day the job is finished: 30 days for most repairs, 90 days for painting, 48 hours for cleaning and for reporting damage in transit.",
          },
          {
            p: "What decides who pays is what you find when you get there, and you are the one who records it. Only the same fault coming back is unpaid. A different problem, nothing wrong, or damage caused since the last visit — all three become an ordinary job at the ordinary price and you are paid normally. The customer is told all of this before we send you out, so you are not the one breaking the news at their door.",
          },
          {
            p: "Looking is always free and always covered, so you are never guessing at the doorstep to protect your own time. If it turns out to be a different problem, you say so in the app and the customer agrees before you start — never afterwards, and never more than the original job cost. If they say no, the job ends there and you are paid for the trip.",
          },
          {
            p: "That is why the verdict has to be honest in both directions. Calling a genuine recurrence something else takes money from a customer who was promised otherwise. Calling a new job a recurrence takes a morning's work from you for nothing.",
          },
          {
            p: "It never covers damage the fault caused — the water from a leak, food spoiled by an outage — parts the customer supplied, or work you advised and they declined. Write that advice on the job at the time you give it. Three weeks later it is the only thing that protects you.",
          },
          {
            p: "If a customer keeps claiming and the visits keep finding nothing, that is ours to look at, not yours to absorb. Tell us and we will.",
          },
        ],
      },
      {
        id: "what-we-look-at",
        heading: "What we actually look at",
        blocks: [
          {
            p: "All of it is compared against other professionals doing the same category of work, not against a fixed number. A category where every job is cash is not a suspicious category.",
          },
          {
            ul: [
              "Final amounts that cluster at or just below the published minimum, far more often than your peers.",
              "Jobs cancelled after you have met the customer, again far more often than your peers.",
              "Customers who confirm an amount different from the one you recorded.",
              "Customers who book you once, then keep using SajiloKaam for other work and never book through it again.",
              "Jobs marked finished that never settle at all.",
            ],
          },
        ],
      },
      {
        id: "never-a-signal",
        heading: "What is never a signal",
        blocks: [
          {
            p: "These are named because a system that punished them would be punishing good work, and because you should be able to do all of them without wondering:",
          },
          {
            ul: [
              "Charging less than the band. A cheap, fast job is a good job.",
              "Taking cash. It is the primary way Nepal pays and it always will be here.",
              "Turning work down. You are allowed to be busy.",
              "Offering to fit a customer in beside a job you already have. The offer itself is never held against you — only offering and then not arriving is, and handing that job straight back the moment you know is not counted as refusing work.",
              "A customer turning down your price after a survey. We pay you for the visit either way, and the only thing measured is whether you went.",
              "A customer complaint on its own. Complaints are read, not counted.",
              "Working few jobs, or being new.",
              "Carrying a guarantee balance. It is money owed, not a finding against you: it does not move you down the list, it is not one of the five steps below, and no part of this page is triggered by it.",
            ],
          },
        ],
      },
      {
        id: "the-ladder",
        heading: "The five steps",
        blocks: [
          {
            p: "Nothing here triggers on one job. Each step names what it costs and how it is lifted.",
          },
          {
            dl: [
              {
                term: "1. You are told, privately",
                detail:
                  "The numbers we are seeing, on your own dashboard, next to your category's average. No penalty, nothing a customer can see, no record kept if it stops. Most of this ends here.",
              },
              {
                term: "2. List position",
                detail:
                  "You appear lower in search while the pattern continues, and recover as it stops. Automatic, reversible, and never permanent. Nothing is removed and nothing is public.",
              },
              {
                term: "3. Digital settlement, and no open jobs",
                detail:
                  "New jobs settle by eSewa or Khalti only, and you stop being offered jobs from the open pool — customers who ask for you by name still reach you. A person decides this, not a score, and it is lifted after a conversation and a run of clean jobs.",
              },
              {
                term: "4. Payouts held, listing hidden",
                detail:
                  "Your listing stops appearing while the review runs, and money already earned waits rather than being paid out. It is not taken. If the review clears you, it is released in full with an apology.",
              },
              {
                term: "5. Removed, and the fee reclaimed",
                detail:
                  "For confirmed, deliberate under-reporting: the listing is removed permanently and the commission that was avoided is charged. Where a customer was overcharged, they are refunded first, before we recover anything.",
              },
            ],
          },
        ],
      },
      {
        id: "appeal",
        heading: "Your appeal, at every step",
        blocks: [
          {
            p: "At every step you can see what triggered it, in numbers, and ask a person to look again. An appeal is answered by a human being, not by the same system that raised it.",
          },
          {
            p: "Steps 3, 4 and 5 are never automatic. A person reviews the evidence and can undo any of them.",
          },
        ],
      },
      {
        id: "payouts",
        heading: "Why digital reaches you sooner",
        blocks: [
          {
            p: "A digital payment is confirmed by eSewa or Khalti themselves, so we can pay it out quickly. Cash has to be reconciled against a confirmation the customer types, so it waits longer. That difference is an operational fact, not a punishment — and it is the reason we would rather grow digital payments than inspect cash for ever.",
          },
          {
            p: "On work with a long guarantee — 90 days or more — a quarter of your earning arrives 30 days after the rest. It is held, not taken: the two parts add up to everything you earned on that job, and nothing about it changes what you are paid. We do it because a guarantee that runs for three months outlives a payout that clears in a week, so on those jobs a fault can appear long after the money has gone.",
          },
          {
            p: "The rule is the length of the guarantee, not the name of the trade. Any work we list with a guarantee of 90 days or more is held this way, so if we add a trade with a long guarantee later, it will be held too — you will not find out from a smaller number in your account. Today that is painting.",
          },
          {
            p: "If you are carrying a balance from a refund, a quarter of each of those two payments can go towards it — a quarter of what actually arrives on the day, never a quarter of the whole job taken out of the first part. Your job screen shows both amounts, both dates, and what is left owing.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "हाम्रा मापदण्ड, र उल्लङ्घन भए के हुन्छ",
    lead:
      "कम रकम लेखिएका काम र प्लेटफर्म बाहिर गएको पैसालाई सजिलोकामले कसरी हेर्छ — के गनिन्छ, के कहिल्यै गनिँदैन, र हरेक चरणले के खर्च गराउँछ।",
    updated: "2026-09-26",
    sections: [
      {
        id: "why",
        heading: "यो पृष्ठ किन",
        blocks: [
          {
            p: "राम्रो काम गर्ने र इमानदारीसाथ रकम लेख्ने प्राविधिकले नलेख्नेभन्दा कहिल्यै घाटा बेहोर्नु हुँदैन। कुरा यत्ति हो। तलका हरेक नियम इमानदार बाटोलाई नै फाइदाजनक बनाउन बनेका हुन्, र दर्ता गर्नुअघि तपाईंले पढ्न नपाउने हो भने यीमध्ये कुनैको अर्थ छैन।",
          },
          {
            p: "मान्छे पक्रनुभन्दा नियम बुझाउन हामीलाई मन पर्छ। यस पृष्ठमा लुकाइएको केही छैन, र तेस्रो चरणदेखि माथिको कुनै पनि कुरा मान्छेले नहेरी हुँदैन।",
          },
        ],
      },
      {
        id: "the-fee-minimum",
        heading: "शुल्कमा न्यूनतम किन",
        blocks: [
          {
            p: "हाम्रो कमिसन १५% हो, र यो कामको अन्तिम रकम वा त्यो सेवाको प्रकाशित न्यूनतम — जुन बढी हुन्छ, त्यसैमा लाग्छ। धाराको प्रकाशित दायरा रु ९०० बाट सुरु हुन्छ भने तपाईंले रु ४०० लेख्नुभयो भने पनि शुल्क रु ९०० मै गणना हुन्छ।",
          },
          {
            p: "यो सजाय होइन, र यसले तपाईंबारे कुनै अनुमान गर्दैन। पाएको भन्दा कम रकम लेख्दा कसैलाई केही फाइदा नहोस् भन्नका लागि हो — अर्थात् तपाईंलाई त्यसो गर्न भन्नुपर्ने कारण नै कसैसँग रहँदैन।",
          },
          {
            p: "कहिलेकाहीँ काम साँच्चै दायराभन्दा सानो हुन्छ — धारालाई वासर मात्र चाहिएको थियो। त्यही कुरा कामकै पानामा लेख्नुहोस्, मान्छेले हेर्छ, प्रायः त्यही दिन। पूरै सेवाका काम बारम्बार न्यूनतमभन्दा तल आइरहेछन् भने त्यो हाम्रो मूल्य गलत भएको हो, तपाईंको होइन — हामी दायरा नै मिलाउँछौँ, र त्यसका लागि कसैलाई कारबाही हुँदैन।",
          },
        ],
      },
      {
        id: "the-guarantee",
        heading: "ग्यारेन्टी, र यसले तपाईंलाई के खर्च गराउँछ",
        blocks: [
          {
            p: "त्यो सेवाका लागि तोकिएको अवधिभित्र उही समस्या फेरि देखियो भने हामी फेरि मान्छे पठाउँछौँ र ग्राहकले केही तिर्नु पर्दैन — यो वाचा हामीले गरेका छौँ, र पूरा गर्ने तपाईंले हो: तपाईं आफैँ गएर मिलाइदिनुहुन्छ, र त्यो दोस्रो भ्रमणको ज्याला हुँदैन।",
          },
          {
            p: "साँच्चै जान नसक्ने अवस्था भयो — तपाईंले यो पेसा छाड्नुभयो, वा ग्राहकले अर्कै मान्छे माग्नुभयो — भने हामी अर्को प्राविधिक पठाउँछौँ र उहाँको कामको पूरै ज्याला दिन्छौँ। उहाँलाई दिइएको रकम तपाईंको आउँदो कमाइबाट कटाइन्छ, तर एक पटकको भुक्तानीको बढीमा एक चौथाइ मात्र — जसले गर्दा तपाईंको कुनै हप्ता शून्य हुँदैन। यो तपाईंकै ड्यासबोर्डमा घट्दै गएको रकमका रूपमा देखिन्छ। हामी फोन गरेर नगद माग्दैनौँ, र तपाईंले पाइसक्नुभएको पैसा फिर्ता लिँदैनौँ।",
          },
          {
            p: "बाँकी रकम देखिने अर्को बाटो फिर्ता हो। दोस्रो पटक गएर पनि मिलेन र यहाँका कुनै मान्छेले ग्राहकलाई पैसा फिर्ता गर्ने निर्णय गरे भने, त्यो कामको हाम्रो कमिसन हामी पूरै छाड्छौँ — नबनेको कामबाट शुल्क राख्दैनौँ — र त्यसमा तपाईंको हिस्सा बाँकी रकम बन्छ। पूरै फिर्ता भएको कामको हकमा त्यो भनेको त्यही कामबाट तपाईंले कमाएको सबै हो। दुईमध्ये ठूलो यही हो, र भइहाल्नुअघि थाहा पाउनु राम्रो।",
          },
          {
            p: "बाँकी रकम जसरी बनेको भए पनि आउँदो कमाइबाट कटाउने तरिका उस्तै हो: एक पटकको भुक्तानीको एक चौथाइभन्दा बढी कहिल्यै होइन, र शून्य पुगेपछि रोकिन्छ। जति नै बाँकी भए पनि हरेक भुक्तानीको तीन चौथाइ तपाईंकहाँ जस्ताको तस्तै आइपुग्छ — सीमा राखिएको यही कारणले हो। नराम्रो महिनाले हप्ताभरिको कमाइ लैजान सक्दैन, र पाइसक्नुभएको पैसा फिर्ता माग्ने काम कहिल्यै हुँदैन।",
          },
          {
            p: "काम गर्न छाड्नुभयो भने यो सकिन्छ। बाह्र महिनासम्म एउटै काम सकिएन भने बाँकी रकम मिनाहा हुन्छ — रोकिने होइन, अरूलाई बेचिने होइन, तपाईंलाई पर्खिने पनि होइन: सकियो, र यसबारे कसैले तपाईंलाई सम्पर्क गर्दैन। त्यही बेला सूची बन्द हुन्छ, त्यसैले फर्कनुभयो भने पुरानो ऋण कुरेर बसेको भेट्नुहुन्न — फेरि निवेदन दिनुहुन्छ। यो तपाईंविरुद्धको कुनै ठहर होइन, र सूची हटाइनुजस्तो पनि होइन; बन्द सूचीले तपाईंले काम गर्न छाड्नुभयो भन्ने मात्र जनाउँछ, र निवेदन दिन तपाईंलाई स्वागत छ।",
          },
          {
            p: "अवधि काम सकिएको दिनदेखि गनिन्छ: धेरैजसो मर्मतमा ३० दिन, रङरोगनमा ९० दिन, सफाइ र बाटोमा भएको क्षति जनाउन ४८ घण्टा।",
          },
          {
            p: "खर्च कसले बेहोर्ने भन्ने तपाईंले त्यहाँ पुगेर जे भेट्नुहुन्छ त्यसैले तय हुन्छ, र त्यो लेख्ने पनि तपाईं नै हो। उही समस्या फर्केको अवस्थामा मात्र ज्याला हुँदैन। अर्कै समस्या, केही नबिग्रेको अवस्था, वा गएपछि पुगेको क्षति — यी तीनै सामान्य काम बन्छन्, सामान्य मूल्य लाग्छ, र तपाईंले सधैँझैँ पाउनुहुन्छ। यी सबै कुरा हामीले तपाईंलाई पठाउनुअघि नै ग्राहकलाई भनिसकेका हुन्छौँ, त्यसैले ढोकैमा उभिएर यो कुरा सुनाउने काम तपाईंको होइन।",
          },
          {
            p: "हेर्ने काम सधैँ निःशुल्क हो र त्यो हामी बेहोर्छौँ, त्यसैले आफ्नो समय जोगाउन ढोकैमा अनुमान लगाउनुपर्दैन। अर्कै समस्या रहेछ भने एपमै लेख्नुहोस्, र तपाईंले सुरु गर्नुअघि ग्राहकले मान्नुहुन्छ — पछि होइन, र पहिलेको कामभन्दा महँगो पनि होइन। मान्नुभएन भने काम त्यहीँ टुङ्गिन्छ र आउजाउको पैसा तपाईंले पाउनुहुन्छ।",
          },
          {
            p: "त्यसैले जे भेटिन्छ त्यही लेख्नुपर्छ, दुवैतिर। साँच्चै फर्केको समस्यालाई अर्कै भन्दा वाचा गरिएको ग्राहकबाट पैसा लिइन्छ। नयाँ काम भएकोलाई फर्केको भन्दा तपाईंकै आधा दिन सित्तैमा जान्छ।",
          },
          {
            p: "समस्याले पुर्‍याएको क्षति — चुहावटको पानी, बिजुली नआउँदा बिग्रेको खाना — ग्राहकले आफैँ ल्याएका पार्ट्स, र तपाईंले सल्लाह दिँदादिँदै उहाँले नगराउनुभएको काम: यी कहिल्यै समेटिँदैनन्। त्यो सल्लाह दिएकै बेला कामको पानामा लेख्नुहोस्। तीन हप्तापछि तपाईंलाई जोगाउने त्यही मात्र हो।",
          },
          {
            p: "कुनै ग्राहकले बारम्बार उजुरी गरिरहनुहुन्छ र गएर हेर्दा हरेक पटक केही भेटिँदैन भने, त्यो हेर्नुपर्ने हाम्रो काम हो, तपाईंले बेहोर्ने होइन। हामीलाई भन्नुहोस्, हामी हेर्छौँ।",
          },
        ],
      },
      {
        id: "what-we-look-at",
        heading: "हामी के हेर्छौँ",
        blocks: [
          {
            p: "यी सबै कुरा तोकिएको अङ्कसँग होइन, उही सेवा गर्ने अरू प्राविधिकसँग तुलना गरेर हेरिन्छ। सबै काम नगदमा हुने सेवा आफैँमा शङ्कास्पद होइन।",
          },
          {
            ul: [
              "अन्तिम रकम बारम्बार प्रकाशित न्यूनतममै वा त्यसभन्दा अलिकति तल आउनु — साथीभाइभन्दा धेरै पटक।",
              "ग्राहकलाई भेटिसकेपछि काम रद्द हुनु — यो पनि अरूभन्दा धेरै पटक।",
              "ग्राहकले लेखेको रकम र तपाईंले लेखेको रकम फरक पर्नु।",
              "ग्राहकले तपाईंलाई एक पटक बुक गरेपछि अरू कामका लागि सजिलोकाम चलाइरहने तर तपाईंलाई फेरि कहिल्यै बुक नगर्नु।",
              "सकियो भनिएको तर भुक्तानी नै नभएका काम।",
            ],
          },
        ],
      },
      {
        id: "never-a-signal",
        heading: "के कहिल्यै सङ्केत होइन",
        blocks: [
          {
            p: "यी कुरा किन लेखिएका छन् भने यिनलाई कारबाहीको आधार बनाउनु भनेको राम्रो कामलाई सजाय दिनु हो, र यी गर्दा तपाईंले मनमा शङ्का राख्नु नपरोस्:",
          },
          {
            ul: [
              "दायराभन्दा कम शुल्क लिनु। छिटो र सस्तोमा सकिएको काम राम्रो काम हो।",
              "नगद लिनु। नेपालमा भुक्तानीको मुख्य तरिका यही हो, र यहाँ सधैँ रहन्छ।",
              "काम अस्वीकार गर्नु। व्यस्त हुन पाइन्छ।",
              "अर्को काम भइरहेकै बेला ग्राहकलाई मिलाएर गर्ने प्रस्ताव दिनु। प्रस्ताव दिएकै कारण तपाईंलाई केही असर पर्दैन — प्रस्ताव दिएर नआएमा मात्र गनिन्छ, र नभ्याउने थाहा हुनासाथ काम फिर्ता गरिदिनुलाई काम अस्वीकार गरेको मानिँदैन।",
              "सर्वेपछि ग्राहकले तपाईंको मूल्य नमान्नु। जे भए पनि गएबापतको रकम तपाईंले पाउनुहुन्छ, र गनिने भनेको तपाईं गएको हो कि होइन भन्ने मात्र हो।",
              "एउटा गुनासो आउनु। गुनासो पढिन्छ, गनिँदैन।",
              "काम थोरै हुनु, वा नयाँ हुनु।",
              "ग्यारेन्टीको बाँकी रकम बोक्नु। यो तिर्न बाँकी पैसा हो, तपाईंविरुद्धको ठहर होइन: यसले सूचीमा तल पार्दैन, तलका पाँच चरणमध्ये कुनै पनि होइन, र यो पृष्ठको कुनै पनि कुरा यसले सुरु गर्दैन।",
            ],
          },
        ],
      },
      {
        id: "the-ladder",
        heading: "पाँच चरण",
        blocks: [
          {
            p: "एउटा कामले यीमध्ये कुनै पनि चरण सुरु गर्दैन। हरेक चरणले के खर्च गराउँछ र कसरी हट्छ, दुवै तल लेखिएको छ।",
          },
          {
            dl: [
              {
                term: "१. तपाईंलाई निजी रूपमा जानकारी",
                detail:
                  "हामीले देखेका अङ्कहरू तपाईंकै ड्यासबोर्डमा, सेवाको औसतको छेउमा। कुनै कारबाही हुँदैन, ग्राहकले केही देख्दैनन्, र रोकियो भने कुनै रेकर्ड पनि रहँदैन। धेरैजसो कुरा यहीँ सकिन्छ।",
              },
              {
                term: "२. सूचीमा स्थान",
                detail:
                  "क्रम जारी रहेसम्म खोजमा तल देखिनुहुन्छ, रोकिएपछि बिस्तारै उही ठाउँमा फर्किनुहुन्छ। स्वतः हुन्छ, फर्किन्छ, र कहिल्यै स्थायी हुँदैन। केही हटाइँदैन, केही सार्वजनिक हुँदैन।",
              },
              {
                term: "३. डिजिटल भुक्तानी मात्र, र खुला काम बन्द",
                detail:
                  "नयाँ काम इसेवा वा खल्तीबाट मात्र मिल्छ, र खुला सूचीबाट काम आउन बन्द हुन्छ — नाम तोकेर खोज्ने ग्राहक भने तपाईंकहाँ आइरहन्छन्। यो अङ्कले होइन, मान्छेले निर्णय गर्छ, र कुराकानी तथा केही सफा कामपछि हट्छ।",
              },
              {
                term: "४. भुक्तानी रोक्का, सूची लुकाइने",
                detail:
                  "अनुसन्धान चल्दासम्म तपाईंको सूची देखिँदैन, र कमाइसकेको पैसा दिइनुको साटो पर्खिन्छ। खोसिँदैन। अनुसन्धानले सफा ठहर्‍यायो भने पूरै रकम माफीसहित दिइन्छ।",
              },
              {
                term: "५. हटाइने, र शुल्क असुलिने",
                detail:
                  "जानाजान कम रकम लेखेको पुष्टि भएमा: सूची स्थायी रूपमा हट्छ र छलिएको कमिसन असुल गरिन्छ। ग्राहकबाट बढी लिइएको रहेछ भने पहिले उहाँलाई फिर्ता हुन्छ, त्यसपछि मात्र हामी केही असुल्छौँ।",
              },
            ],
          },
        ],
      },
      {
        id: "appeal",
        heading: "हरेक चरणमा तपाईंको भनाइ",
        blocks: [
          {
            p: "हरेक चरणमा त्यो किन सुरु भयो भन्ने अङ्कसहित हेर्न पाउनुहुन्छ, र मान्छेलाई फेरि हेर्न भन्न पाउनुहुन्छ। जवाफ मान्छेले दिन्छ — जुन प्रणालीले उठायो, त्यसैले होइन।",
          },
          {
            p: "तेस्रो, चौथो र पाँचौँ चरण कहिल्यै स्वतः हुँदैनन्। मान्छेले प्रमाण हेर्छ र जुनसुकै चरण फिर्ता लिन सक्छ।",
          },
        ],
      },
      {
        id: "payouts",
        heading: "डिजिटल भुक्तानी किन छिटो पुग्छ",
        blocks: [
          {
            p: "डिजिटल भुक्तानी इसेवा वा खल्तीले आफैँ पुष्टि गर्छन्, त्यसैले हामी छिटो पठाउन सक्छौँ। नगदचाहिँ ग्राहकले लेखेको पुष्टिसँग मिलाउनुपर्ने हुनाले ढिलो हुन्छ। यो फरक कामको प्रकृतिले आएको हो, सजाय होइन — र यही कारणले नगदलाई सधैँ जाँचिरहनुभन्दा डिजिटल भुक्तानी बढाउन हामी रुचाउँछौँ।",
          },
          {
            p: "लामो ग्यारेन्टी हुने काममा — ९० दिन वा बढी — तपाईंले कमाएको रकमको एक चौथाइ बाँकी रकमभन्दा ३० दिनपछि आउँछ। यो रोकिएको हो, काटिएको होइन: दुवै भाग जोड्दा त्यो काममा तपाईंले कमाएको पूरै रकम हुन्छ, र तपाईंले पाउने रकममा कुनै फरक पर्दैन। तीन महिना चल्ने ग्यारेन्टी एक हप्तामा सकिने भुक्तानीभन्दा लामो हुन्छ, त्यसैले त्यस्ता काममा पैसा गइसकेपछि मात्र खोट देखिन सक्छ — त्यही कारण हामी यसो गर्छौं।",
          },
          {
            p: "नियम ग्यारेन्टी कति लामो छ भन्नेमा आधारित छ, कामको नाममा होइन। हामीकहाँ सूचीबद्ध ९० दिन वा बढी ग्यारेन्टी भएको जुनसुकै काममा यसरी रोकिन्छ, त्यसैले पछि लामो ग्यारेन्टी भएको नयाँ काम थपियौँ भने त्यसमा पनि रोकिनेछ — खातामा कम रकम देखेर मात्र थाहा पाउनुपर्ने छैन। अहिलेलाई त्यो रङरोगन हो।",
          },
          {
            p: "फिर्ताबाट आएको बाँकी रकम तपाईंमाथि छ भने, ती दुई भुक्तानी प्रत्येकबाट एक चौथाइसम्म त्यसैमा जान सक्छ — त्यो दिन साँच्चै आउने रकमको एक चौथाइ, पहिलो भागबाटै पूरै कामको एक चौथाइ कहिल्यै होइन। तपाईंको कामको पर्दामा दुवै रकम, दुवै मिति र अझै कति बाँकी छ, सबै देखिन्छ।",
          },
        ],
      },
    ],
  },
};
