import os
import re
import json

# python pyscript/convert_list_song_to_json.py
# Define the raw list of songs with format: "Song Name" – Artist
raw_songs = """
"Hơn Cả Yêu" – Đức Phúc
"Em Gái Mưa" – Hương Tràm"Anh Cứ Đi Đi" – Hari Won
"Phía Sau Một Cô Gái" – Soobin Hoàng Sơn
"Tháng Tư Là Lời Nói Dối Của Em" – Hà Anh Tuấn
"Đưa Em Về Nhàa" – Grey D và Chillies
"Bạn Đời" – Karik và GDucky
"À Lôi" – Double2T và Masew
"Nấu Ăn Cho Em" – Đen và PiaLinh
"Cắt Đôi Nỗi Sầu" – Tăng Duy Tân
"See Tình" – Hoàng Thùy Linh
Hẹn Một Mai – Bùi Anh Tuấn
Tình Yêu Màu Nắng – Đoàn Thúy Trang
Một Nhà – Da LAB
Ngày Chưa Giông Bão – Bùi Lan Hương
Có Em Chờ – Min ft. Mr.A
Yêu 5 – Rhymastic
Người Lạ Ơi – Karik ft. Orange
Đi Đu Đưa Đi – Bích Phương

Truyền Thái Y – Ngô Kiến Huy

Chạy Ngay Đi – Sơn Tùng M-TP
"Bùa Yêu" – Bích Phương
Sau Tất Cả – Erik

Em Gái Mưa – Hương Tràm

Tháng Tư Là Lời Nói Dối Của Em – Hà Anh Tuấn

Nơi Này Có Anh – Sơn Tùng M-TP

Hơn Cả Yêu – Đức Phúc
Góc Ban Công – Thịnh Suy

Lửng Lơ – Mew Amazing

Trà Sữa – Orange (bản acoustic)

Vì Anh Đâu Có Biết – Madihu ft. Vũ

Bài Không Tên – Chillies
"Tình Bạn Diệu Kỳ" – AMEE, Ricky Star, Lăng LD
Phía Sau Em – Kay Trần, Binz

SOFAR – Binz

Sao Cũng Được – Binz

Chốn Lao Xao – Tùng TeA, Tony Huymie

Gene – Binz, Touliver

Rượu Tình – Nam Đức

Crying Over You – JustaTee, Binz

Anh Là Người Xấu – Thái Vũ (BlackBi), T Team

Forever Love – Karik, LK, BigDaddy, Dương Trần Nghĩa, Yanbi, T-Akayz, Andree, Đen, Binz

They Said – Binz, Touliver

Mười Năm (Lộn Xộn 3) – Đen, Ngọc Linh

Làm Vì Yêu – B Ray

Ex's Hate Me – B Ray, Masew, AMee

Do For Love – B Ray, AMee

Bài Này Chill Phết – Đen, MIN

Hai Triệu Năm – Đen, Biên

Tình Nhân Ơi – Superbrothers, Orange, Binz

Anh Đếch Cần Gì Nhiều Ngoài Em – Đen, Vũ, Thành Đồng

Ghé Qua – Dick, Tofu, PC

Bạn Tình Ơi – Yuni Boo, Goctoi Mixer

Bài Ca Tuổi Trẻ – JGKiD, KraziNoyze, Emcee L, Da LAB, Vũ Bùi Thu Thủy, Linh Cáo, MelG

Lộn Xộn 2 – Đen

Cho Tôi Lang Thang – Ngọt, Đen

Hà Nội Xịn – LK

Anh Biết – Xám, D.Blue

Tát Nước Đầu Đình – Lynk Lee, Binz

Thôi Anh Không Chơi – Binz

Nến Và Hoa – Rhymastic

When You Look At Me – Seachains, Obito

Lặng Lẽ Buông – Rô Ti, Yuni Boo

Bánh Bèo "Đông Lào" – Osad

Đưa Nhau Đi Trốn (Chill Version) – Đen, Linh Cáo

Con Trai Cưng – B Ray, Masew

Mình Cưới Nhau Đi – Huỳnh James, Pjnboys

Con Gái Rượu – B Ray

Em Đừng Đi – Sơn Tùng M-TP

Ai Biết – WEAN

Thương – Karik, Uyên Pím

Làm Gì Phải Hốt – JustaTee, Hoàng Thùy Linh, Đen

Xin Anh Đừng – Emily, LK, JustaTee

Một Nhà – Da LAB

Làm Người Luôn Yêu Em – Sơn Tùng M-TP

2AM – JustaTee, BigDaddy

2 Phút Hơn – Pháo, Wack

Từng Là Tất Cả – Karik

Dành Cho Em (Prod. By CM1X) – Lou T

Thương Nhiều Hơn Nói – Đạt G, B Ray, Masew

Anh Em Tốt – Siro, Phong Cận, Mr Vịt, Kairon

Tháng 7 Của Anh, Em Và Cô Đơn – Khói

Ý Em Sao – Kay Trần, Lăng LD, Homie Boiz

Trò Đùa (Rap Version) – Quang Đăng Trần, T-one

Lớp 13 – Tui Hát

Mẹ Ơi 2 – Jack

Loving You (Sunny) – Kimmese, Đen

Mãi Yêu Mình Em – Da Fame, Vũ Phụng Tiên

Bâng Khuâng – JustaTee

Fila – Công Hòa, Chỉ Hoa

Đi Học Thêm – Piggy, Sony Tran, Gizmo

Ngon Lành Cành Đào – JC Hưng, Phúc Bồ, TSIXK

Cuộc Gọi Cũ (Prod. Longdrae) – Deus Tiến Đạt

Để Đó Anh Lo – Jack

Em Đang Làm Gì Đấy – Quang Anh Rhyder, Feliks Alvin

GANH – N'Small, Pháo

Tiều Phu Và Công Chúa – Nam Đức, Freak D

Em Hãy Ở Nhà – Khói

Đừng Cách Ly Anh – So Hi, Seachains

Trời Ơi Con Chưa Muốn Chết – Đen

Hát Cho Đời Và Hát Cho Em – Emcee L, Đen, Rabbit Run, JGKiD

Dưới Hiên Nhà (Prod. By Gerry Retro) – Đen, Emcee L, JGKiD

Người Âm Phủ – Osad

Cạn Pin – D-Mex, Hardy

Không Thể Không Sợ Vợ – Lâm Nguyên, Nhii

Anh Thèm Được Ngủ – Khói

Anh Không Hiểu – Sơn Tùng M-TP

Ngày Khác Lạ – Đen, Giang Phạm, Triple D

Dưới Hiên Nhà – Đen, JGKiD, Emcee L

Stay At Home – Nimbia, F, Evy

Có Anh Rồi – Den Den, Nguyên Tạ

Forever Alone – JustaTee
"Để Mị Nói Cho Mà Nghe" – Hoàng Thùy Linh

"Gác Lại Âu Lo" – Da LAB, Miu Lê
Có Khi Nào Rời Xa – Bích Phương

Em Gái Mưa – Hương Tràm

Tháng Tư Là Lời Nói Dối Của Em – Hà Anh Tuấn

Anh Cứ Đi Đi – Hari Won

Người Ấy – Trịnh Thăng Bình

Tình Yêu Màu Nắng – Đoàn Thúy Trang ft. BigDaddy

Giữ Em Đi – Thùy Chi

Chỉ Là Giấc Mơ – Uyên Linh

Nếu Em Còn Tồn Tại – Trịnh Đình Quang

Mình Yêu Nhau Đi – Bích Phương

Yêu Xa – Vũ Cát Tường

Cơn Mưa Ngang Qua – Sơn Tùng M-TP

Đừng Như Thói Quen – JayKii ft. Sara Lưu

Em Sẽ Là Cô Dâu – Minh Vương M4U ft. Huy Cung

Lạc Trôi – Sơn Tùng M-TP

Anh Đang Nơi Đâu – Miu Lê

Chạm Đáy Nỗi Đau – Erik

Buông – Bùi Anh Tuấn

Nơi Này Có Anh – Sơn Tùng M-TP

Anh Nhớ Em Người Yêu Cũ – Hamlet Trương

21–40: Ballad hiện đại được yêu thích
Hơn Cả Yêu – Đức Phúc

Từng Yêu – Phan Duy Anh

Em Không Sai, Chúng Ta Sai – Erik

Sau Tất Cả – Erik

Cảm Nắng – Suni Hạ Linh

Anh Nhà Ở Đâu Thế – AMee ft. B Ray

Gửi Anh Xa Nhớ – Bích Phương

Tình Đơn Phương – Dương Edward

Mãi Mãi Không Phải Anh – Thanh Duy

Người Lạ Ơi – Karik ft. Orange

Thương Em Là Điều Anh Không Thể Ngờ – Noo Phước Thịnh

Mình Chia Tay Đi – Erik

Đừng Hỏi Em – Mỹ Tâm

Anh Ơi Ở Lại – Chi Pu

Đừng Ai Nhắc Về Cô Ấy – Trà My Idol

Em Gái Mưa (Acoustic Version) – Hương Tràm

Chạm Khẽ Tim Anh Một Chút Thôi – Noo Phước Thịnh

Lặng Thầm Một Tình Yêu – Miu Lê

Đã Lỡ Yêu Em Nhiều – JustaTee

Anh Ơi Ở Lại (Ballad Version) – Chi Pu

41–60: Ballad indie và acoustic nhẹ nhàng
Vì Anh Đâu Có Biết – Madihu ft. Vũ

Bước Qua Nhau – Vũ

Anh Đếch Cần Gì Nhiều Ngoài Em – Đen ft. Vũ

Gác Lại Âu Lo – Da LAB ft. Miu Lê

Chuyện Rằng – Thịnh Suy

Tình Yêu Xanh Lá – Thịnh Suy

Em Là Ai – Hà Anh Tuấn

Trốn Tìm – Đen ft. MTV Band

Điều Buồn Nhất – Kai Đinh

Lạ Lùng – Vũ

Mùa Hè Của Em – Vũ

Bước Qua Mùa Cô Đơn – Vũ

Hành Tinh Song Song – Vũ

Mùa Mưa Ngâu Nằm Cạnh – Vũ

Đông Kiếm Em – Vũ

Em Là Ai – Hà Anh Tuấn

Tháng Mấy Em Nhớ Anh – Hà Anh Tuấn

Người Tình Mùa Đông – Hà Anh Tuấn

Chuyện Như Chưa Bắt Đầu – Mỹ Tâm

Tình Yêu Màu Nắng (Acoustic) – Đoàn Thúy Trang

61–80: Ballad mới nổi và triệu view
Thay Tôi Yêu Cô Ấy – Thanh Hưng

Anh Đã Quen Với Cô Đơn – Soobin Hoàng Sơn

Đừng Quên Tên Anh – Hoa Vinh

Yêu Một Người Vô Tâm – Bảo Anh

Em Không Là Duy Nhất – Tóc Tiên

Đừng Như Thói Quen (Acoustic) – JayKii

Em Gái Mưa (Piano Version) – Hương Tràm

Anh Cứ Đi Đi (Acoustic) – Hari Won

Chạm Đáy Nỗi Đau (Acoustic) – Erik

Sau Tất Cả (Piano Version) – Erik

Tháng Tư Là Lời Nói Dối Của Em (Acoustic) – Hà Anh Tuấn

Có Khi Nào Rời Xa (Piano Version) – Bích Phương

Người Ấy (Acoustic) – Trịnh Thăng Bình

Giữ Em Đi (Piano Version) – Thùy Chi

Mình Yêu Nhau Đi (Acoustic) – Bích Phương

Yêu Xa (Piano Version) – Vũ Cát Tường

Cơn Mưa Ngang Qua (Acoustic) – Sơn Tùng M-TP

Đừng Như Thói Quen (Piano Version) – JayKii

Em Sẽ Là Cô Dâu (Acoustic) – Minh Vương M4U

Lạc Trôi (Piano Version) – Sơn Tùng M-TP

81–100: Ballad trữ tình sâu lắng
Tình Đơn Phương (Acoustic) – Dương Edward

Mãi Mãi Không Phải Anh (Piano Version) – Thanh Duy

Người Lạ Ơi (Acoustic) – Karik ft. Orange

Thương Em Là Điều Anh Không Thể Ngờ (Piano Version) – Noo Phước Thịnh

Mình Chia Tay Đi (Acoustic) – Erik

Đừng Hỏi Em (Piano Version) – Mỹ Tâm

Anh Ơi Ở Lại (Acoustic) – Chi Pu

Đừng Ai Nhắc Về Cô Ấy (Piano Version) – Trà My Idol

Em Gái Mưa (Live Version) – Hương Tràm

Chạm Khẽ Tim Anh Một Chút Thôi (Acoustic) – Noo Phước Thịnh

Lặng Thầm Một Tình Yêu (Piano Version) – Miu Lê

Đã Lỡ Yêu Em Nhiều (Acoustic) – JustaTee

Anh Ơi Ở Lại (Live Version) – Chi Pu

Chạm Đáy Nỗi Đau (Live Version) – Erik

Sau Tất Cả (Live Version) – Erik

Tháng Tư Là Lời Nói Dối Của Em (Live Version) – Hà Anh Tuấn

Có Khi Nào Rời Xa (Live Version) – Bích Phương

Người Ấy (Live Version) – Trịnh Thăng Bình

Giữ Em Đi (Live Version) – Thùy Chi

Mình Yêu Nhau Đi (Live Version) – Bích Phương
Địa Đàng (Remix) – Hoàng Oanh

Tuyết Yêu Thương (Remix) – Nhiều nghệ sĩ

Cảm Ơn Em (WM Remix) – Đặng Thiên Chí

8 Vạn 6 Ngàn Thương (Remix) – Hạo

Nơi Vực Nơi Trời (Remix) – Lê Bảo Bình

Trả Lại Thanh Xuân Cho Em (Domino Remix) – Mochiii, ACV, Domino

Anh Đau Từ Lúc Em Đi (Duzme Remix) – Trần Mạnh Cường

Đừng Hỏi Em Ổn Không (1988s Remix) – Diệu Vân, H2K

Chuyến Xe Cuộc Đời (Remix) – Thanh Hưng, ACV

Cánh Hoa Héo Tàn (Domino Remix) – Khánh Phương

Ải Hồng Nhan (Royce x GemV Remix) – Dunghoangpham

Tái Sinh (Remix Style Huy PT) – Tùng Dương, meChill

Trương Đình Hoàng (SS x AM Remix) – Lil Van

Để Anh Lương Thiện (Huy PT Remix) – Linh Hương Luz, Meme Media

Anh Đã Quen Với Cô Đơn (Remix) – Soobin Hoàng Sơn

Em Gái Mưa (Remix) – Hương Tràm

Lạc Trôi (Remix) – Sơn Tùng M-TP

Nơi Này Có Anh (Remix) – Sơn Tùng M-TP

Buồn Của Anh (Remix) – Masew, Đạt G, K-ICM

Em Gái Mưa (Acoustic Version) – Hương Tràm

See Tình – Hoàng Thùy Linh

I Wanna Dance – Đông Nhi

Bay – Thu
Thuyền Và Biển – Bảo Yến

Người Tình Trăm Năm – Đàm Vĩnh Hưng

Điều Giản Dị – Phạm Khánh Hưng

Dạ Khúc Cho Tình Nhân – Quang Dũng

Đường Xa Ướt Mưa – Quỳnh Lan

Lâu Đài Tình Ái – Cẩm Ly, Quốc Đại

Em Là Tất Cả – Dương Ngọc Thái

Cơn Mưa Tình Yêu – Hà Anh Tuấn, Phương Linh

Yêu Và Yêu – ERIK

Nếu Như Anh Đến – Văn Mai Hương

Và Em Đã Yêu (Acoustic Version) – Hồ Ngọc Hà

Hương Ngọc Lan – Mỹ Linh

Em Về Tinh Khôi – Trần Thu Hà

Vì Đó Là Em – Quang Dũng

Không Còn Mùa Thu – Mỹ Linh

Chuyện Tình Hoa Trắng – Như Quỳnh

Người Tình Mùa Đông – Như Quỳnh

Làm Sao Anh Nói – Lâm Nhật Tiến

Đi Về Nơi Xa – Trương Quý Hải

Hà Nội Mùa Vắng Những Cơn Mưa – Trương Quý Hải

Phép Màu – MAYDAYs

Dancing In The Dark – SOOBIN

Don't Say You Love Me – Jin

Bùa Yêu – Bích Phương

See Tình – Hoàng Thùy Linh

Anh Cứ Đi Đi – Hari Won

Người Lạ Ơi – Superbrothers, Karik, Orange

Trốn Tìm – Đen Vâu

Lâu Lâu Nhắc Lại – Hà Nhi, Khói

Ai Chung Tình Bằng Cô Đơn – Hồ Ngọc Hà

Là Anh – Phạm Lịch

Bước Qua Nhau – Vũ

Bước Qua Mùa Cô Đơn – Vũ

Gặp Nhưng Không Ở Lại – Hiền Hồ

Yêu Xa – Vũ Cát Tường

Giúp Em Trả Lời Những Câu Hỏi – Bích Phương

Đêm Em Chờ – Bích Phương

Phai Dấu Cuộc Tình – Bích Phương

Nơi Nào Có Anh – Bích Phương

Vâng Anh Đi Đi – Bích Phương

Dẫu Có Lỗi Lầm – Phương Vy

Đường Xưa – Phương Vy

60 Năm Cuộc Đời – Phương Vy

Rồi Mai Thức Giấc – Phương Vy

Tôi Tìm Thấy Tôi – Phương Vy

Tạm Biệt – Phương Vy

Xin Cho Tôi – Phương Vy

Chị Tôi – Phương Vy

Ngỡ Đâu Tình Đã Quên Mình – Phương Vy

Đêm Đô Thị – Phương Vy

Mong Ước Kỷ Niệm Xưa – Phương Vy

Nhé Anh – Phương Vy

Từng Ngày Dài – Phương Vy

Thương Nhau Ngày Mưa – Phương Vy

Nếu Có Yêu Tôi – Phương Vy

Nụ Cười Và Những Ước Mơ – Phương Vy

Lúc Mới Yêu – Phương Vy

Giấc Mơ Tuyết Trắng – Thủy Tiên

Tình Yêu Màu Nắng – Đoàn Thúy Trang, BigDaddy

Em Gái Mưa – Hương Tràm

Sầu Lẻ Bóng – Lệ Quyên

Chuyện Tình Không Dĩ Vãng – Lệ Quyên

Nếu Hai Đứa Mình – Lệ Quyên

Đêm Tâm Sự – Lệ Quyên

Tình Lỡ – Lệ Quyên

Đoạn Tuyệt – Lệ Quyên

Mưa Nửa Đêm – Lệ Quyên

Trách Ai Vô Tình – Lệ Quyên

Đừng Nói Xa Nhau – Lệ Quyên

Đêm Buồn Tỉnh Lẻ – Lệ Quyên

Tình Yêu Trả Lại Trăng Sao – Lệ Quyên

Sầu Tím Thiệp Hồng – Lệ Quyên

Chuyện Ba Mùa Mưa – Lệ Quyên

Người Đi Ngoài Phố – Lệ Quyên

Vùng Lá Me Bay – Lệ Quyên

Cỏ Úa – Lệ Quyên

Đêm Cuối – Lệ Quyên

Tình Nghèo Có Nhau – Lệ Quyên

Tình Đời – Lệ Quyên

Tình Đơn Phương – Lệ Quyên

Yesterday Once More – Carpenters (Lời Việt: Trường Kỳ)

Top Of The World – Carpenters (Lời Việt: Trường Kỳ)

Endless Love – Lionel Richie, Diana Ross (Lời Việt: Lê Xuân Trường)

My Heart Will Go On – Celine Dion (Lời Việt: Phạm Duy)

Right Here Waiting – Richard Marx (Lời Việt: Trịnh Nam Sơn)

Nothing's Gonna Change My Love For You – George Benson (Lời Việt: Nhật Ngân)

I Will Always Love You – Whitney Houston (Lời Việt: Vũ Xuân Hùng)

How Deep Is Your Love – Bee Gees (Lời Việt: Phạm Duy)

I Just Called To Say I Love You – Stevie Wonder (Lời Việt: Trường Kỳ)

Unchained Melody – The Righteous Brothers (Lời Việt: Phạm Duy)

The Power Of Love – Celine Dion (Lời Việt: Phạm Duy)

You Are The Sunshine Of My Life – Stevie Wonder (Lời Việt: Trường Kỳ)

Have I Told You Lately – Rod Stewart (Lời Việt: Phạm Duy)

When You Say Nothing At All – Ronan Keating (Lời Việt: Trịnh Nam Sơn)

I Don't Want To Miss A Thing – Aerosmith (Lời Việt: Vũ Xuân Hùng)

Because I Love You – Stevie B (Lời Việt: Nhật Ngân)

I Swear – All-4-One (Lời Việt: Trường Kỳ)

More Than Words – Extreme (Lời Việt: Phạm Duy)

Everything I Do (I Do It For You) – Bryan Adams (Lời Việt: Trịnh Nam Sơn)

Always – Bon Jovi (Lời Việt: Vũ Xuân Hùng)
Phép Màu – MAYDAYs, Minh Tốc & Lam

Giảm Các Cảm Giác – Minh Đinh

ĐẶT TRÁI TIM LÊN BÀN – Tùng

Một Lời Đồn – Tùng

Vạn Vật Như Muốn Ta Bên Nhau – Rio

Wrong Times – Puppy, Dangrangto

Anh Đã Chờ Rất Lâu – Sixkie Dawgz

Trở Thành Quá Khứ – T.R.I

Câu Trả Lời – J.ADE

Tình Yêu Buông Tha Cho Chúng Ta – Trungg I.U, Lâm Bảo Ngọc

Mình Lượn Lờ Làm Wen (NOVINA) – VCC Left Hand

Giờ Thì – buitruonglinh

Có Đôi Điều – Shiki

Từng Ngày Yêu Em – buitruonglinh

Một Đời – 14 Casper, Bon Nghiêm, buitruonglinh

Bình Yên – Vũ., Binz

Em Hỏi Thăm Anh Được Không – ren

Miss You Like Crazy – 7UPPERCUTS, Only C

1000 Ánh Mắt – Shiki, Obito

Hư Không – Kha

Không Yêu Em Thì Yêu Ai? – Vũ., Low G

Dù Em Từng Yêu – buitruonglinh

id 072019 – W/n

Suýt Nữa Thì... – Andiez

Yên Bình Có Quá Đắt Không – Khiem

Vì Điều Gì – buitruonglinh, Dangrangto, Minsicko

Một Bài Hát Không Vui Mấy (Extended Version) – T.R.I, Dangrangto, DONAL

Lần Đầu Tiên – Emcee L, Muộii

Nếu Những Tiếc Nuối – Vũ.

Lắng Nghe – Vũ Thanh Vân

Ngỡ Như Là (Cover) – Vũ.

Hennesy (Acoustic Version) – Haisam

Loanh Quanh – Mademoiselle

Celina – WEAN

Hà Nội Khóc Ở Sài Gòn – Vũ Thanh Vân, TRANG

Chạy Trốn Với Nhau – TRANG, Khoa Vũ

Là – Vũ.

Con Dế Mèn Hát Vào Mùa Hè – Tùng, TRANG

Thấy Chưa – Ngọt

Ở Sân Bay, Nobody Knows – Haisam

Lạnh Thôi Đừng Mưa – Haisam

Phút Ban Đầu (Live) – Vũ.

Ngày Nào – Pink Frog

Mấy Khi – Ngọt

Một Giấc Mơ – Mademoiselle

Một Người Nhẹ Nhàng Hơn – TRANG, Tiên Tiên

Break Your Man – Pink Frog

Tôi Và Em – Pink Frog

Chàng Trai Mặc Áo Xanh – Mademoiselle

Thương – Lê Cát Trọng Lý

Níu Ân Tình – 2Shy

Và Thế Giới Đã Mất Đi Một Người Cô Đơn – marzuz, Gill, Onionn

Em Có Còn Dùng Số Này Không – Thái Đinh

Chênh Vênh – Lê Cát Trọng Lý

Đông Kiếm Em – Vũ.

Một Nhà – Da LAB

Lạ Lùng – Vũ.

Thế Thôi – Minh Vương M4U, Lil Shady, Khánh Won

1 Phút – Andiez

Cafe, Thuốc Lá Và Những Ngày Vui – Thế Bảo

Đừng Trốn Trong Phòng – Da LAB, Kimmese

Em Trang Trí – Ngọt

Lắng Nghe – Vũ Thanh Vân

Ngỡ Như Là (Cover) – Vũ.

Hennesy (Acoustic Version) – Haisam

Loanh Quanh – Mademoiselle

Celina – WEAN

Hà Nội Khóc Ở Sài Gòn – Vũ Thanh Vân, TRANG

Chạy Trốn Với Nhau – TRANG, Khoa Vũ

Là – Vũ.

Con Dế Mèn Hát Vào Mùa Hè – Tùng, TRANG

Thấy Chưa – Ngọt

Ở Sân Bay, Nobody Knows – Haisam

Lạnh Thôi Đừng Mưa – Haisam

Phút Ban Đầu (Live) – Vũ.

Ngày Nào – Pink Frog

Mấy Khi – Ngọt

Một Giấc Mơ – Mademoiselle

Một Người Nhẹ Nhàng Hơn – TRANG, Tiên Tiên

Break Your Man – Pink Frog

Tôi Và Em – Pink Frog

Chàng Trai Mặc Áo Xanh – Mademoiselle

Thương – Lê Cát Trọng Lý

Níu Ân Tình – 2Shy

Và Thế Giới Đã Mất Đi Một Người Cô Đơn – marzuz, Gill, Onionn

Em Có Còn Dùng Số Này Không – Thái Đinh

Chênh Vênh – Lê Cát Trọng Lý

Đông Kiếm Em – Vũ.

Một Nhà – Da LAB

Lạ Lùng – Vũ.

Thế Thôi – Minh Vương M4U, Lil Shady, Khánh Won

1 Phút – Andiez

Cafe, Thuốc Lá Và Những Ngày Vui – Thế Bảo

Đừng Trốn Trong Phòng – Da LAB, Kimmese

Em Trang Trí – Ngọt

Lắng Nghe – Vũ Thanh Vân

Ngỡ Như Là (Cover) – Vũ.

Hennesy (Acoustic Version) – Haisam

Loanh Quanh – Mademoiselle

Celina – WEAN
Duyên Phận – Như Quỳnh

Lòng Mẹ – Chế Linh

Vùng Lá Me Bay – Khánh Ly

Hoa Trinh Nữ – Giao Linh

Mưa Rừng – Tuấn Vũ

Giọt Nước Mắt Cho Người – Hương Lan

Đắp Mộ Cuộc Tình – Như Quỳnh

Cỏ Úa – Chế Linh

Tình Bơ Vơ – Giao Linh

Nỗi Đau Muộn Màng – Minh Cảnh

Thao Thức Vì Em – Hương Lan

Phượng Buồn – Tuấn Vũ

Đừng Trách Người Yêu Tôi – Bảo Yến

Biển Tình – Lệ Thu

Mưa Đêm Ngoại Ô – Thanh Tuyền

Ai Ra Xứ Huế – Duy Khánh

Riêng Một Góc Trời – Chế Linh

Đời Cho Ta Như Cơn Mơ – Hương Lan

Ngày Xưa Hoàng Thị – Khánh Ly

Lời Cuối Cho Em – Tuấn Vũ
Hoa Nở Không Màu – Hoài Lâm

Em Gái Mưa – Hương Tràm

Một Bước Yêu Vạn Dặm Đau – Mr. Siro

Có Em Chờ – MIN

Người Lạ Ơi – Karik, Orange

Bùa Yêu – Bích Phương

Anh Nhà Ở Đâu Thế – Amee

Đừng Yêu Nữa, Em Mệt Rồi – Min

Nơi Này Có Anh – Sơn Tùng M-TP

Chạy Ngay Đi – Sơn Tùng M-TP

Lạc Trôi – Sơn Tùng M-TP

Hơn Cả Yêu – Đức Phúc

Cầu Hôn – Karik, Orange

Anh Ơi Ở Lại – Chi Pu

Yêu 5 – Rhymastic

Bigcityboi – Binz

Chạm Đáy Nỗi Đau – ERIK

Buồn Làm Chi Em Ơi – Hoài Lâm

Đau Đầu – JustaTee, Phương Ly

Ai Chung Tình Được Mãi – Đan Trường
Hương Ngọc Lan – OST Mắt Biếc (Ngọt)

Có Chàng Trai Viết Lên Cây – OST Mắt Biếc (Phan Mạnh Quỳnh)

Đừng Hỏi Em – OST Tấm Cám: Chuyện Chưa Kể (Mỹ Tâm)

Nơi Này Có Anh – OST Em Là Bà Nội Của Anh (Sơn Tùng M-TP)

Anh Ơi Ở Lại – OST Chạy Đi Rồi Tính (Chi Pu)

Để Mị Nói Cho Mà Nghe – OST Mắt Biếc (Hoàng Thùy Linh)

Mắt Biếc – OST Mắt Biếc (Văn Mai Hương)

Yêu Em Rất Nhiều – OST Em Chưa 18 (Soobin Hoàng Sơn)

Ta Còn Gì Khi Mất Nhau – OST Gạo Nếp Gạo Tẻ (Trịnh Thăng Bình)

Điều Anh Biết – OST Em Là Bà Nội Của Anh (Chi Dân)

Đừng Về Trễ – OST Tình Yêu Và Tham Vọng (Trung Quân Idol)

Yêu Là Tha Thu – OST Gạo Nếp Gạo Tẻ (Trúc Nhân)

Chạm Khẽ Tim Anh Một Chút Thôi – OST Mối Tình Đầu Của Tôi (Noo Phước Thịnh)

Tự Tâm – OST Mị Ngọt (Như Quỳnh)

Người Tình Mùa Đông – OST Người Tình Mùa Đông (Quang Dũng)
Có Khi Nào Rồi – Vũ

Mơ – Tiên Tiên

Gặp Nhưng Không Ở Lại – Hiền Hồ

Phía Sau Một Cô Gái – Soobin Hoàng Sơn

Lặng Thầm – Nguyễn Trọng Tài

Một Đêm Say – Phan Mạnh Quỳnh

Anh Đếch Cần Gì Nhiều Ngoài Em – Đen

Nơi Này Có Anh (Acoustic) – Sơn Tùng M-TP

Ai Là Người Thương Em – Thanh Hưng

Anh Nhà Ở Đâu Thế (Acoustic) – Amee

Giữ Em Đi – Đông Nhi

Buồn Của Anh – K-ICM, Đạt G

Vài Lần Đón Đưa – Nguyễn Trọng Tài

10 Năm – Đen

Hạnh Phúc Mới – Nguyễn Trọng Tài

Yêu Đơn Phương – Only C

Mình Cưới Nhau Đi – Huỳnh James, Pjnboys

Ngày Mai – Tóc Tiên

Tháng Tư Là Lời Nói Dối Của Em – Hà Anh Tuấn

Anh Ở Đâu Thế (Cover) – Various Artists
"""

# Extract song and artist using regex
pattern = r'[""]?([^""\n]+?)[""]?\s*–\s*(.+)'
matches = re.findall(pattern, raw_songs)

# Create JSON list
json_list = [{"songName": song.strip(), "levelAuthorName": artist.strip()} for song, artist in matches]

# Create directory if it doesn't exist
os.makedirs("data", exist_ok=True)

# Write the list to a JSON file
file_path = "data/viet_2.json"
with open(file_path, "w", encoding="utf-8") as f:
    json.dump(json_list, f, ensure_ascii=False, indent=2)

print(f"JSON file has been created at: {file_path}")
print(f"Total songs processed: {len(json_list)}")