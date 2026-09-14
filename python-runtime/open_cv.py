import cv2

img = cv2.imread("D:/AI/printed.png")

print(img.shape)
cv2.imshow("img", img)
cv2.waitKey(0)