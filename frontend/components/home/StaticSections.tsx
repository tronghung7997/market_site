"use client";

/** Các section nội dung tĩnh của trang chủ: Cách hoạt động, Tại sao chọn,
 *  Khách hàng nói gì, FAQ, banner CTA bán hàng. Chỉ FAQ có state (mở/đóng).
 *
 *  ⚠️ Testimonials + badge sao ở hero là nội dung DỰNG SẴN (chưa có nguồn
 *  thật) — đang chờ chủ sản phẩm quyết gỡ hay thay số thật; xem checklist
 *  refactor Đợt 4. */

import Link from "next/link";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { ArrowRight, Bolt, Check, Clock, Search, Shield, Star, Verified } from "@/components/Icons";
import { SectionHead } from "./SectionHead";
import { ChevronIcon } from "./MarketSection";

export function HowItWorks() {
  return (
    <section className="border-t border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title="Cách hoạt động" sub="Chỉ 3 bước để nhận hàng an toàn" />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { step: "1", icon: <Search size={22} />, title: "Chọn sản phẩm", desc: "Duyệt danh mục, so sánh giá và chọn gói phù hợp nhu cầu." },
            { step: "2", icon: <Shield size={22} />, title: "Thanh toán ký quỹ", desc: "Tiền được giữ an toàn trong tài khoản ký quỹ cho đến khi bạn xác nhận nhận hàng." },
            { step: "3", icon: <Check size={22} />, title: "Nhận hàng & xác nhận", desc: "Kiểm tra sản phẩm, xác nhận hoàn tất — tiền chuyển cho nhà bán." },
          ].map((item) => (
            <Card key={item.step} className="p-6 relative">
              <span className="absolute top-4 right-5 font-mono text-[40px] font-bold text-faint">{item.step}</span>
              <span className="grid place-items-center h-11 w-11 rounded-lg bg-iris-soft text-iris border border-iris/15">
                {item.icon}
              </span>
              <div className="mt-4 font-medium text-[15px]">{item.title}</div>
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{item.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WhyUs() {
  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title="Tại sao chọn chúng tôi" sub="Nền tảng được thiết kế cho sự tin cậy" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: <Shield size={20} />, title: "Ký quỹ bảo vệ", desc: "Tiền được giữ an toàn, chỉ giải ngân khi người mua xác nhận." },
          { icon: <Bolt size={20} />, title: "Giao ngay tự động", desc: "Sản phẩm giao tức thì sau thanh toán, không cần chờ đợi." },
          { icon: <Verified size={20} />, title: "Nhà bán xác minh", desc: "Mọi nhà bán đều được xác minh danh tính và chất lượng hàng hoá." },
          { icon: <Clock size={20} />, title: "Hỗ trợ 24/7", desc: "Đội ngũ hỗ trợ luôn sẵn sàng giải quyết mọi vấn đề." },
        ].map((item) => (
          <Card key={item.title} interactive className="p-5">
            <span className="grid place-items-center h-10 w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
              {item.icon}
            </span>
            <div className="mt-4 font-medium text-[15px]">{item.title}</div>
            <p className="mt-1 text-[13px] text-muted leading-relaxed">{item.desc}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function Testimonials() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title="Khách hàng nói gì" sub="Đánh giá từ người dùng thực tế" />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { name: "Minh Tuấn", role: "Chủ agency marketing", initials: "MT", quote: "Mua proxy số lượng lớn rất nhanh, ký quỹ giúp yên tâm. Đã dùng hơn 6 tháng, chưa gặp vấn đề gì.", rating: 5 },
            { name: "Thu Hà", role: "Freelancer", initials: "TH", quote: "Tài khoản giao đúng mô tả, hỗ trợ phản hồi cực nhanh. Giá cả cạnh tranh hơn nhiều chỗ khác.", rating: 5 },
            { name: "Đức Anh", role: "Quản lý TMĐT", initials: "ĐA", quote: "Hệ thống ký quỹ minh bạch, giải quyết tranh chấp công bằng. Đội ngũ support rất chuyên nghiệp.", rating: 4 },
          ].map((t) => (
            <Card key={t.name} className="p-6">
              <div className="flex items-center gap-1 text-warn text-[14px]" aria-label={`${t.rating} trên 5 sao`}>
                {Array.from({ length: t.rating }, (_, i) => <Star key={i} size={14} className="fill-warn" />)}
                {Array.from({ length: 5 - t.rating }, (_, i) => <Star key={`e${i}`} size={14} className="text-line-2" />)}
              </div>
              <p className="mt-3 text-[13.5px] text-muted leading-relaxed italic">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-4 flex items-center gap-3">
                <span className="grid place-items-center h-9 w-9 rounded-full bg-iris-soft text-iris text-[13px] font-semibold border border-iris/15">{t.initials}</span>
                <div>
                  <div className="text-[13.5px] font-medium">{t.name}</div>
                  <div className="text-[12px] text-faint">{t.role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS = [
  { q: "Ký quỹ (escrow) hoạt động như thế nào?", a: "Khi bạn thanh toán, tiền được giữ trong tài khoản ký quỹ. Nhà bán giao hàng, bạn kiểm tra và xác nhận — lúc đó tiền mới chuyển cho nhà bán. Nếu có vấn đề, bạn mở tranh chấp trong thời gian ký quỹ." },
  { q: "Tôi có thể yêu cầu hoàn tiền không?", a: "Có. Trong thời gian ký quỹ (thường 3 ngày), nếu sản phẩm không đúng mô tả, bạn có thể mở tranh chấp. Đội ngũ hỗ trợ sẽ xem xét và hoàn tiền nếu nhà bán vi phạm." },
  { q: "Sản phẩm giao ngay tự động là gì?", a: "Một số sản phẩm được cấu hình giao tự động — ngay sau khi thanh toán thành công, bạn nhận được thông tin tài khoản hoặc dữ liệu mà không cần chờ nhà bán xử lý thủ công." },
  { q: "Làm sao để trở thành nhà bán?", a: "Đăng ký tài khoản, sau đó gửi đơn đăng ký gian hàng (tên gian hàng, mô tả, thông tin liên hệ). Quản trị viên xét duyệt đơn — khi được chấp thuận, bạn có thể đăng sản phẩm và bắt đầu bán ngay." },
  { q: "Phương thức thanh toán nào được hỗ trợ?", a: "Chúng tôi hỗ trợ chuyển khoản ngân hàng nội địa, ví điện tử (Momo, ZaloPay), và USDT. Số dư ví trên nền tảng có thể dùng để mua hàng trực tiếp." },
  { q: "Dữ liệu cá nhân của tôi có an toàn không?", a: "Mọi dữ liệu được mã hoá và lưu trữ theo tiêu chuẩn bảo mật. Chúng tôi không chia sẻ thông tin cá nhân với bên thứ ba ngoài mục đích vận hành nền tảng." },
  { q: "Thời gian giao hàng trung bình là bao lâu?", a: "Sản phẩm tự động giao ngay sau khi thanh toán. Với sản phẩm thủ công, nhà bán thường xử lý trong vòng 1–12 giờ tuỳ loại sản phẩm và múi giờ." },
  { q: "Tôi có thể mua số lượng lớn (bulk) không?", a: "Có. Nhiều sản phẩm hỗ trợ mua bulk với giá chiết khấu. Chọn số lượng khi đặt hàng — hệ thống sẽ tự tính giá theo bậc nếu nhà bán đã cấu hình." },
  { q: "Nhà bán có bị giữ tiền không?", a: "Tiền được giữ trong ký quỹ cho đến khi người mua xác nhận nhận hàng hoặc hết thời gian ký quỹ. Sau đó tiền tự động chuyển vào ví nhà bán." },
  { q: "Proxy và tài khoản có bảo hành không?", a: "Tuỳ từng nhà bán và sản phẩm. Thông tin bảo hành được ghi rõ trên trang sản phẩm. Nếu sản phẩm lỗi trong thời gian bảo hành, bạn có thể mở tranh chấp." },
  { q: "Làm sao để liên hệ hỗ trợ?", a: "Bạn có thể mở tranh chấp trực tiếp trên đơn hàng, hoặc liên hệ qua email support@proxora.vn. Đội ngũ hỗ trợ phản hồi trong vòng 24 giờ làm việc." },
  { q: "Tài khoản bị khoá thì phải làm sao?", a: "Liên hệ hỗ trợ kèm email đăng ký để được xác minh và mở khoá. Tài khoản thường bị khoá khi vi phạm điều khoản sử dụng hoặc phát hiện hoạt động bất thường." },
];

export function FaqSection() {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const mid = Math.ceil(FAQ_ITEMS.length / 2);
  const left = FAQ_ITEMS.slice(0, mid);
  const right = FAQ_ITEMS.slice(mid);

  const renderItem = (item: (typeof FAQ_ITEMS)[number], i: number) => (
    <Card key={i} className="overflow-hidden">
      <button
        onClick={() => toggle(i)}
        className="flex items-center justify-between w-full px-5 py-4 text-left"
      >
        <span className="font-medium text-[14px] pr-4">{item.q}</span>
        <ChevronIcon open={openSet.has(i)} />
      </button>
      {openSet.has(i) && (
        <div className="px-5 pb-4 text-[13px] text-muted leading-relaxed border-t border-line pt-3">
          {item.a}
        </div>
      )}
    </Card>
  );

  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title="Câu hỏi thường gặp" sub="Giải đáp nhanh các thắc mắc phổ biến" />
      <div className="grid gap-2 md:grid-cols-2 md:gap-x-5 md:gap-y-2 items-start">
        <div className="space-y-2">
          {left.map((item, i) => renderItem(item, i))}
        </div>
        <div className="space-y-2">
          {right.map((item, i) => renderItem(item, mid + i))}
        </div>
      </div>
    </section>
  );
}

export function CtaBanner() {
  return (
    <section className="border-t border-line aura">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16 text-center">
        <h2 className="font-serif text-[clamp(1.6rem,3vw,2.4rem)] tracking-tight">
          Bắt đầu bán hàng trên <span className="text-iris italic">Proxora</span>
        </h2>
        <p className="mt-3 text-[14px] text-muted max-w-md mx-auto leading-relaxed">
          Đăng ký tài khoản nhà bán, đăng sản phẩm và bắt đầu kiếm thu nhập từ hàng hoá số của bạn.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/seller/apply"><Button size="lg">Đăng ký bán hàng <ArrowRight size={16} /></Button></Link>
          <Link href="#market"><Button size="lg" variant="secondary">Xem chợ</Button></Link>
        </div>
      </div>
    </section>
  );
}
