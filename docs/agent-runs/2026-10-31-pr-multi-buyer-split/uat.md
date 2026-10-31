# UAT: ek requisition, kai buyers, kai RFQ, kai PO, kai GRN (owner ke liye)

Date: 2026-10-31. Kahan chalana hai: sirf localhost (frontend 3000, backend 8000), dev data par. Production par nahi.
Ye script QA ne likhi hai, screen par live dekhi nahi gayi: **NOT SEEN LIVE**. Jahan UI ka naam alag dikhe, wahi note karke batao.

Har step me likha hai: kaun login kare, kahan click kare, kya dikhna chahiye, aur galat hone par kaisa dikhega.
Passwords yahan nahi hain. Har role ke liye apna test user use karo (naam neeche).

## A. Pehle taiyari (admin, ek baar)

Test users (role ke hisaab se, naam kuch bhi rakh sakte ho):

| Role | Kaam |
|---|---|
| Requester | PR banata hai, apna tracker dekhta hai. Purchase ya vendor ka koi access nahi. |
| Buyer A | Purchase team, sirf apni lines. |
| Buyer B | Purchase team, sirf apni lines. |
| Buyer C | Purchase team, reassign test ke liye. |
| Purchase Head | Purchase team + "All buyers' lines" ticked. Admin nahi. |
| PO approver | PO ke pehle approval stage me. Buyer A/B nahi hona chahiye. |
| Partner | Final PO approval (Company Info > Partners me Partner mark). |
| Store keeper | Goods receipt (GRN) karta hai. |

1. **Admin** login karo. Settings (gear icon) > Roles & Permissions kholo.
2. **Buyer role** (A, B, C ka role) me: Procurement > Purchase Requisitions ke andar **"My Lines tab"** = View tick karo.
   "Assign buyer" = Edit **tick mat karo**. "All buyers' lines (purchase head)" **tick mat karo**.
   Dikhna chahiye: role save ho jata hai. Galat: My Lines menu buyer ko nahi dikhta.
3. **Purchase Head role** me: Procurement > Purchase Requisitions ke andar **"Assign buyer" = Edit** aur **"All buyers' lines (purchase head)" = View aur Edit** dono tick karo. Ye box apne aap kisi ko nahi milta, sirf role par tick karne se milta hai. Save karo.
   Dikhna chahiye: Purchase Head user ko My Lines me "all buyers" ka option milta hai.
4. Procurement > Settings (gear) > **"Buyer for each item type"**: ek item type (jaise Material) ka buyer = Buyer A, doosre item type (jaise Consumable) ka buyer = Buyer B chuno. Save karo.
   Dikhna chahiye: dono jagah user ka naam bhar jata hai. Isi se PR ki lines apne aap alag buyers ko jaati hain.
5. Organization > Approval Workflows > **Purchase order**: pehla stage = PO approver, doosra stage = Partner (koi bhi ek). Save karo.
   Dikhna chahiye: do stage dikhte hain. Galat: sirf Partner stage hai (tab PO approver wala step test nahi hoga).
6. Do vendors Vendors tab me active rakho (V1, V2). Store me ek receiving store (ship-to) rakho.
   Items Item Master me ho: ek Material type ka item (L1 ke liye), ek Consumable type ka item (L2), ek Material type ka item (L3).

## B. Requisition banao aur approve karo

7. **Requester** login. Procurement > Purchase Requisitions > New. Teen lines daalo: L1 (Material, qty 100), L2 (Consumable, qty 5), L3 (Material, qty 10). Submit karo.
   Dikhna chahiye: PR "Waiting for approval". Galat: error me "Something went wrong" jaisa generic message.
8. PR ke approvers se approve karwao (jitne stage ho).
   Dikhna chahiye: PR "Approved - with procurement".
9. **Requester** wahi PR kholo. Lines table ke neeche **"Procurement progress"** card dikhna chahiye.
   - Upar PR approval: kis ne approve kiya aur kab.
   - Har line: Buyer ka naam (L1 aur L3 = Buyer A, L2 = Buyer B), stage "With buyer - RFQ not sent yet", Ordered 0.
   - Vendor ka naam, rate, amount **kahin nahi** dikhna chahiye.
   Galat: vendor ya rate dikhe, ya line ka buyer khali ho.

## C. Do buyers, do RFQ

10. **Buyer A** login. Procurement > **My Lines**. Sirf L1 aur L3 dikhni chahiye (L2 nahi). Sort PR number ke hisaab se.
    Dikhna chahiye: "To buy" aur "Not yet ordered" quantity.
11. Buyer A: apni PR group par **Raise RFQ** dabao. RFQ me sirf L1 aur L3 ho. Vendor V1 ki quote file daalo, terms bharo (payment terms, delivery time, late delivery clause), **Submit**.
    Dikhna chahiye: RFQ "locked"/sent. PR ka status "RFQ out for quotes".
    Galat: RFQ me L2 bhi aa gayi, ya vendor ko bheji mail me L2 likhi hai.
12. **Buyer B** login. My Lines me sirf L2. **Raise RFQ**, V1 ki quote file, terms, Submit.
    Dikhna chahiye: Buyer B ki RFQ alag number ki. Buyer A ki RFQ par koi asar nahi.
13. **Buyer B** se Buyer A ki RFQ ka link kholne ki koshish karo (agar B ka data scope "assigned" hai).
    Dikhna chahiye: "403"/access nahi ka saaf message. Galat: B ko A ki quotes ya rates dikh jaayein.
14. **Requester** PR par wapas: Procurement progress me L1/L3 par Buyer A ka RFQ number, L2 par Buyer B ka RFQ number, aur "x quotes in" count (naam/rate nahi).

## D. Quotes aur split award

15. **Buyer A**: RFQ > Quotations me V1 ki quote bharo (L1 100 @100, L3 10 @50). V2 ki quote: L1 sirf **60** (vendor itna hi de sakta hai) @110.
    Buyer B: apni RFQ me V1 ki quote L2 5 @7.
    Dikhna chahiye: V2 ki quote me L1 ki quantity 60, 100 se upar nahi ja sakti (error: "asks for 100"). L2 ka rate Buyer A ki RFQ me bharne par error "is not on RFQ".
16. **Buyer A**: Comparison/Award me L1 ko **split** karo: V1 = 40, V2 = 60 (V2 ke liye kaaran likho, kyunki wo sabse sasta nahi). L3 poora V1 ko.
    Dikhna chahiye: "Awarded 100 / To buy 100". Galat: 70 + 50 daalne par bhi save ho jaaye (sahi: "Awarded 120 is more than the 100 still to buy. Reduce an award by 20").
    Kaaran khali chhodne par error jo line, vendor aur rank (L2) batata hai.
17. **Buyer B**: L2 poora V1 ko award.
18. **Requester**: progress me teeno lines "Vendor chosen - PO to upload".

## E. Teen PO, har ek ka apna approval

19. **Buyer A**: Upload PO. Vendor V1 chuno. Dialog me L1 = 40 aur L3 = 10 dikhni chahiye (quantity sirf kam ki ja sakti hai, 40 se zyada nahi). Rate, tax, Tally PO number, PDF, ship-to store bharo. Save.
    Dikhna chahiye: PO-1 ban gaya, approval me gaya. PR ka status "PO in approval".
    Galat: L1 = 45 save ho jaaye (sahi: "45 is more than the 40 awarded").
20. **Buyer A**: dobara Upload PO, vendor V2, L1 = 60, alag Tally number. Phir **Buyer B**: Upload PO, V1, L2 = 5, apna Tally number.
    Dikhna chahiye: teen alag PO (PO-1, PO-2, PO-3), teeno approval me. Buyer B A ki RFQ par upload nahi kar sakta (403 jisme A ka naam aaye).
21. **Requester** progress dekho: L1 par do PO number (PO-1, PO-2), L3 par PO-1, L2 par PO-3. Har PO ke saath "Waiting for approval". Ordered 100/10/5. **Vendor/rate nahi**.
22. **Purchase Head** wahi PR kholo: ab usko vendor ka naam dikhna chahiye (jinko PO ka rate dekhne ka haq hai unko), rate tracker me phir bhi nahi.

## F. PO reject aur dobara upload

23. **PO approver** login > Purchase Orders > PO-2 (V2 wala) > **Reject**, kaaran likho ("rate budget se upar"). PR ke upar jo Reject button hai wo bhi use kar sakte ho, par PO-2 chunna zaroori hai.
    Dikhna chahiye:
    - Sirf PO-2 "cancelled". PO-1 aur PO-3 waise hi approval me.
    - **PR rejected nahi hota.** Status "PO in approval" hi rehta hai.
    - L1 ki 60 quantity wapas "Vendor chosen - PO to upload" me, award bana rehta hai.
    Galat: poori PR reject ho gayi, ya PO-1/PO-3 cancel ho gaye.
24. **Dhyan do (known gap, QA ne pakda):** Buyer A aur Requester ko bell notice milna chahiye jisme PO number aur reject ka kaaran likha ho. Abhi Buyer A ko sirf "PO was rejected by X" milta hai (kaaran nahi) aur Requester ko kuch nahi milta. Ye step abhi fail dikhega jab tak fix na ho.
25. **Buyer A**: V2 ke liye dobara Upload PO, L1 = 60, wahi Tally number (purane cancelled PO ka number free ho jaata hai).
    Dikhna chahiye: naya PO ban jaata hai. Galat: "Tally number already on PO-2" error (cancelled PO par nahi aana chahiye).

## G. Approvals, ek ek PO ke

26. Buyer A khud PO-1 approve karne ki koshish kare (ya Requester): **403** aana chahiye. Jisne PO upload kiya wo apna PO approve nahi kar sakta.
27. **PO approver**: PO-1 approve. Phir **Partner**: PO-1 approve. (Do PO ek saath pending ho to har PO ko alag chunna padta hai.)
    Dikhna chahiye: PO-1 "With vendor" (released). PR ka status abhi bhi "PO in approval", kyunki PO-3 aur naya PO-2 abhi pending hain.
    **Requester** progress me PO-1 par "Approved by <approver> aur <partner>, date".

## H. Store: partial GRN

28. **Store keeper**: Goods Receipt > PO-1 par GRN banao, L1 ke 25 pieces receive karo, inspection me sab pass.
    Dikhna chahiye: GRN ban gaya. PR status abhi bhi "PO in approval".
29. Store keeper PO-3 par GRN banane ki koshish kare (PO-3 abhi approval me).
    Dikhna chahiye: saaf message jisme PO-3 ka number aur "approval" likha ho, aur 409. PO-1 par receiving chalti rahe.
30. PO approver + Partner: PO-2 (naya) aur PO-3 approve.
    Dikhna chahiye: PR status ab **"Partly received"** (kyunki kuch maal accept ho chuka hai).
31. **Store keeper**: PO-2 par L1 ke 60, PO-3 par L2 ke 5, aur PO-1 par dusra GRN: L3 ke 10 aur L1 ke 8 receive + pass.
32. **Requester** progress dekho:
    - L1: Ordered 100, Accepted 93, Pending 7, stage "Partly received". PO-1 ke neeche do GRN (25 aur 8), PO-2 ke neeche ek GRN (60).
    - L2 aur L3: "Received".
    - Upar progress: lines done 2 of 3.
    - Bell me har complete GRN ka ek notice (Teams nahi).
    Galat: koi number negative, ya ek GRN do PO ke neeche dikhe.

## I. Short-close aur band

33. **Purchase Head**: PR kholo > **Short-close Requisition**. Kaaran khali chhodkar dabao.
    Dikhna chahiye: "Give a reason..." jaisa saaf error. Kaaran likho ("Vendor last 7 nahi de sakta") aur confirm.
34. Dikhna chahiye: PR "Closed". L1 stage "Closed short", Accepted 93 jaisa tha. PO-1 "Short-closed". **Requester** ko bell notice (kaaran ke saath).
35. Store keeper PO-1 par aur GRN banane ki koshish kare: 409 "...was closed on ..." (naya requisition banao).
36. Alag PR par (sab kuch poora receive karo): header "Received" ho, aur Close Requisition bina kaaran ke ho jaata hai.
    Short-close ya Close tab block hona chahiye jab koi PO approval me ho ya koi GRN inspection ka intezaar kare (message me PO / GRN ka number).

## J. Buyer reassign (Purchase Head)

(Nayi PR par: L1 aur L3 Buyer A, L2 Buyer B; A ka RFQ submit + award tak ho chuka ho, PO abhi upload nahi hua.)

37. **Purchase Head** > My Lines > "All buyers" > L3 par **Reassign** > Move to buyer = Buyer C, kaaran "A is overloaded" > Save.
    Dikhna chahiye: L3 ka buyer C. Bell notice A, C aur Requester ko (Teams nahi). A ki RFQ me L3 "Moved to C by Head: reason" ke saath grey/withdrawn.
38. **Buyer A** My Lines: L3 nahi dikhni chahiye. **Buyer C** My Lines: L3 dikhni chahiye.
39. **Buyer A** ka Upload PO dialog pehle se khula tha (L1 + L3). Save dabao.
    Dikhna chahiye: 409 jisme bataya ho ki L3 ab C ke paas hai, kuch save nahi hota. Sirf L1 ke saath save karo to PO ban jaata hai.
40. **Buyer A** ko L3 par Short-close ya Reassign karke dekhne do: 403, message me C ka naam aur "Purchase head" ka zikr.
41. Buyer A (jisko "All buyers' lines" nahi mila) se **Reassign** try: 403 ("Moving a line ... is for the Purchase head").
42. B ki draft RFQ jisme sirf L2 thi: Head L2 ko C ko de de. B us RFQ ko Submit kare: "This RFQ has no lines" jaisa error. C apni nayi RFQ L2 par bana sake.

## K. Raste me aur check

43. **Unrelated user** (jiska is PR se koi lena dena nahi, ya sirf Store ka GRN access hai) PR ka link khole: 403/access nahi.
44. **Requester** apni PR par: PO ya vendor wale buttons/section na dikhein.
45. Buyer A ki RFQ ke liye "Raise RFQ" dobara dabao: wahi draft wapas aati hai, duplicate nahi banti.
46. Ek line ko Store se poora issue kar do (stock se): wo line RFQ me nahi aani chahiye; aadhi issue ki ho to RFQ me sirf bacha hua hissa (jaise 100 me se 30 issue to 70).
47. Ek vendor ki quote ki validity beet chuki ho (valid until purani date): usko award karne par error "quote can't be awarded: ... expired" aana chahiye.

## Pass / Fail kaise likho

Har step ke aage Pass ya Fail likho aur fail par screenshot + exact message. Step 24 abhi Fail aayega (ye jaanta hua gap hai). Baaki me koi bhi Fail ho to Manager ko step number batao.

## Jo QA ne code se check kiya par screen par nahi dekha

- Upload PO dialog ka vendor-pehle layout, Reassign/Short-close popups, My Lines page ka design, Procurement progress card (mobile par): NOT SEEN LIVE. 1366x768 aur 390x844 par dekhna zaroori hai.
- verify: Role editor me "My Lines tab" aur "All buyers' lines" ka exact label/position.
